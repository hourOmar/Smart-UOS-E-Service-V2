"""The workflow end to end with fake data, Storage and Gemini: what is stored, models,
no syllabus text or verbatim quotes in the stored evidence, rejection only after REJECT."""

import hashlib
import json

from app.agents.course_equivalency import gemini_calls, rejection_gemini, request_data, service, workflow
from app.agents.course_equivalency.match_verifier import verify_matches
from app.core import storage

from .fakes import RID, SID_NEW, SID_OLD, TOKEN, decision, make_data, make_text_docx, make_text_pdf, patch_gemini, registry_rows

OLD_LINES = ["Introduction to Programming syllabus.", "Topics: Loops and iteration basics; Arrays and strings.",
             "Assessment: exams and assignments."]
NEW_LINES = ["Programming I syllabus.", "Topics: Loops and iteration basics; Arrays and strings; Recursion.",
             "Assessment: exams and assignments."]
PDF = make_text_pdf(OLD_LINES)
DOCX = make_text_docx(NEW_LINES)


def setup(monkeypatch, result=None, verified=True):
    data = make_data(syllabi=registry_rows(old_size=len(PDF), new_size=len(DOCX)))
    monkeypatch.setattr(request_data, "load_request_data", lambda rid: data)
    objects = {f"{RID}/old/{SID_OLD}.pdf": PDF, f"{RID}/new/{SID_NEW}.docx": DOCX}
    tokens = []
    monkeypatch.setattr(storage, "download_object", lambda b, p, t, *, max_bytes: tokens.append(t) or objects[p])
    seen = patch_gemini(monkeypatch, result=result)
    if verified:
        course = {"title": "T", "credit_hours": 3, "topics": ["Loops", "Arrays"], "learning_outcomes": ["code"],
                  "assessment": {"exams": 60, "assignments": 40}}
        raw = {"old": course, "new": course, "outcome_matches": [{"new_index": 0, "old_index": 0, "strength": "full",
                                                                  "old_quote": "Loops and iteration basics", "new_quote": "Loops and iteration basics"}],
               "topic_matches": [{"new_index": i, "old_index": i, "strength": "full", "old_quote": q, "new_quote": q}
                                 for i, q in enumerate(("Loops and iteration basics", "Arrays and strings"))]}
        orig = gemini_calls.analyze_syllabi

        def analyze(old_text, new_text, request_id=""):
            orig(old_text, new_text, request_id)
            return {"status": "ok", "error": None, "analysis": verify_matches(raw, old_text, new_text), "model": "model-analysis"}
        monkeypatch.setattr(gemini_calls, "analyze_syllabi", analyze)
    monkeypatch.setattr(rejection_gemini, "get_rejection_suggestions",
                        lambda ctx: {"status": "unavailable", "error": None, "judgment_keywords": [], "suggested_reasons": [],
                                     "conflict_note": ""})
    return seen, tokens


def test_approve_run_stores_references_and_no_syllabus_text_or_quotes(monkeypatch):
    seen, tokens = setup(monkeypatch)
    out = workflow.run_course_equivalency_agents(RID, TOKEN)
    assert out.eligibility["recommendation"] == "APPROVE" and tokens == [TOKEN, TOKEN]
    stored = service.completed_outcome(out)
    blob = json.dumps(stored, default=str)
    for text in OLD_LINES + NEW_LINES + ["Loops and iteration basics", TOKEN]:
        assert text not in blob, text
    assert [r["side"] for r in stored["evaluated_syllabi"]] == ["old", "new"]
    assert stored["evaluated_syllabi"][0]["sha256"] == hashlib.sha256(PDF).hexdigest()
    assert stored["assessment_model"] == "model-decision" and stored["rejection_explanation"] is None
    ev = stored["evidence"]
    assert ev["models"] == {"syllabus_analysis": "model-analysis", "decision": "model-decision", "rejection": None}
    assert ev["policy_status"] == "draft_thresholds" and len(ev["knowledge_files"]) == 3
    assert ev["eligibility_result"]["equivalency_label"] == "EQUIVALENT"
    assert stored["deterministic_results"]["similarity"]["overall_similarity_percent"] == 100.0
    assert "quote_from_completed_syllabus" not in blob
    # Gemini did see the quotes / texts (in memory only)
    assert "Loops and iteration basics" in seen["analysis"][0][0]


def test_reject_run_keeps_the_rejection_explanation(monkeypatch):
    setup(monkeypatch, result=decision("REJECT", "Not equivalent."))
    out = workflow.run_course_equivalency_agents(RID, TOKEN)
    stored = service.completed_outcome(out)
    assert stored["recommendation"] == "REJECT" and stored["rejection_explanation"]["status"] in ("unavailable", "fallback", "needs_manual_explanation")

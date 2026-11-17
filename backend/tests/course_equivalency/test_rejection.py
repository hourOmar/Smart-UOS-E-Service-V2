"""Rejection explanation agent, ported from the standalone tests, plus the output safeguard."""

from app.agents.course_equivalency import eligibility, output_safeguard, rejection, rejection_gemini
from app.agents.course_equivalency.rejection import allowed_numbers, template_reasons, validate_reasons

from .fakes import RID, decision, make_analysis, make_data, patch_gemini, sides


def _evaluate(monkeypatch, recommendation="REJECT", **kw):
    patch_gemini(monkeypatch, analysis=make_analysis(n_new=4, full=1, out_full=0),
                 result=decision(recommendation, "Low similarity.", ["Trees not covered"]))
    return eligibility.evaluate_course_equivalency_request(RID, make_data(**kw), sides())


def _suggest(monkeypatch, out):
    monkeypatch.setattr(rejection_gemini, "get_rejection_suggestions", lambda ctx: out)


def test_not_applicable_when_not_rejected(monkeypatch):
    patch_gemini(monkeypatch)
    r = eligibility.evaluate_course_equivalency_request(RID, make_data(), sides())
    assert rejection.explain_rejection_workflow(r)["status"] == "not_applicable"


def test_verified_keywords_and_gemini_reasons(monkeypatch):
    r = _evaluate(monkeypatch, old_credit=2)
    sim = r["evidence"]["similarity"]["overall_similarity_percent"]
    good = {"tone": "formal", "text": f"The syllabus comparison shows {sim}% similarity, so the request cannot be approved.",
            "addresses_keywords": ["similarity_below_threshold", "missing_course_topics"]}
    bad_number = {"tone": "concise", "text": "The courses are 99.9% similar.", "addresses_keywords": ["similarity_below_threshold"]}
    no_kw = {"tone": "supportive", "text": "Sorry.", "addresses_keywords": ["made_up"]}
    _suggest(monkeypatch, {"status": "ok", "error": None, "judgment_keywords": ["learning_outcomes_gap", "unknown_kw"],
                           "suggested_reasons": [good, bad_number, no_kw], "conflict_note": ""})
    res = rejection.explain_rejection_workflow(r)
    ids = {k["id"] for k in res["keywords"]}
    assert {"similarity_below_threshold", "missing_course_topics", "credit_hours_lower", "learning_outcomes_gap"} <= ids
    assert "unknown_kw" not in ids and res["status"] == "ok" and len(res["suggested_reasons"]) == 1 and len(res["notes"]) == 2


def test_fallback_templates_when_gemini_unavailable(monkeypatch):
    r = _evaluate(monkeypatch)
    _suggest(monkeypatch, {"status": "unavailable", "error": "no key", "judgment_keywords": [], "suggested_reasons": [],
                           "conflict_note": ""})
    res = rejection.explain_rejection_workflow(r)
    assert res["status"] == "unavailable" and [x["tone"] for x in res["suggested_reasons"]] == ["formal", "concise", "supportive"]
    assert "%" in res["suggested_reasons"][0]["text"]


def test_constraint_and_failing_grade_keywords(monkeypatch):
    patch_gemini(monkeypatch)
    r = eligibility.evaluate_course_equivalency_request(RID, make_data(grade="C", in_plan=False, transferred=60), sides())
    _suggest(monkeypatch, {"status": "unavailable", "error": "x", "judgment_keywords": [], "suggested_reasons": [], "conflict_note": ""})
    ids = {k["id"] for k in rejection.explain_rejection_workflow(r)["keywords"]}
    assert {"grade_below_minimum", "course_not_in_study_plan", "transfer_credit_limit_exceeded"} <= ids
    r = _evaluate(monkeypatch, grade="F")
    assert "old_course_not_passed" in {k["id"] for k in rejection.explain_rejection_workflow(r)["keywords"]}


def test_validate_reasons_helpers():
    ctx = allowed_numbers("similarity 42.5 required 60")
    kept, dropped = validate_reasons([{"tone": "formal", "text": "42.5 of 60", "addresses_keywords": ["a"]},
                                      {"tone": "formal", "text": "77", "addresses_keywords": ["a"]}], {"a"}, ctx)
    assert len(kept) == 1 and len(dropped) == 1
    assert template_reasons({}, []) == []


def test_rejection_context_has_no_student_identity(monkeypatch):
    r = _evaluate(monkeypatch)
    seen = []
    monkeypatch.setattr(rejection_gemini, "get_rejection_suggestions",
                        lambda ctx: seen.append(ctx) or {"status": "unavailable", "error": None, "judgment_keywords": [],
                                                        "suggested_reasons": [], "conflict_note": ""})
    rejection.explain_rejection_workflow(r)
    sent = repr(seen[0])
    assert "Synthetic Distinctname" not in sent and "U99000001" not in sent and "SYNTHETIC-REASON" not in sent


def test_output_safeguard_replaces_contacts_and_drops_suggestions_with_them(monkeypatch):
    r = _evaluate(monkeypatch)
    r["reasoning"] = "Contact prof@uni.example or U12345678 for details."
    r, changed = output_safeguard.clean_eligibility(r)
    assert changed == 2 and "@" not in r["reasoning"] and "U12345678" not in r["reasoning"]
    _suggest(monkeypatch, {"status": "ok", "error": None, "judgment_keywords": [], "conflict_note": "",
                           "suggested_reasons": [{"tone": "formal", "text": "Write to advisor.office@sharjah.ac.ae for help.",
                                                  "addresses_keywords": ["missing_course_topics"]}]})
    res, dropped = output_safeguard.check_rejection(rejection.explain_rejection_workflow(r))
    assert dropped == 1 and res["status"] == "fallback" and len(res["suggested_reasons"]) == 3
    assert all("@" not in s["text"] for s in res["suggested_reasons"])

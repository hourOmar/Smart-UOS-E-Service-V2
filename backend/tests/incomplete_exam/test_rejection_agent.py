"""Agent 6. The first block is the standalone tests/test_rejection_agent.py
(minus the command-line paste/file tests); the rest covers its Gemini call
through the shared client."""

import copy
import hashlib
import json
from pathlib import Path

import pytest

from app.agents.incomplete_exam import rejection_gemini as gs
from app.agents.incomplete_exam.exceptions import InvalidAgent5ResultError
from app.agents.incomplete_exam.llm_calls import recording_calls
from app.agents.incomplete_exam.rejection_agent import explain_rejection_workflow
from app.agents.incomplete_exam.rejection_input import validate_agent5_result
from app.agents.incomplete_exam.rejection_keywords import detect_deterministic_keywords, load_keyword_vocabulary
from app.config import get_settings
from app.core import gemini

from .fakes import FakeClient, api_error, rejection_reply

with open(Path(__file__).parent / "fixtures" / "agent5_late_submission.json", encoding="utf-8") as _f:
    SAMPLE = json.load(_f)

RULES_SHA256 = "eb06df407fd39aaec891d90303cae03755e3cfce7d8b798f32bfd8222d950f4e"


def fake(monkeypatch, **kw):
    base = {"status": "ok", "error": None, "judgment_keywords": [], "suggested_reasons": [], "conflict_note": ""}
    base.update(kw)
    monkeypatch.setattr(gs, "get_rejection_suggestions", lambda ctx: base)


def reason(text="Your request was filed 9 working days after the exam; the limit is 3.", ids=("late_submission",)):
    return {"tone": "formal", "text": text, "addresses_keywords": list(ids)}


# --- standalone tests ---------------------------------------------------------

def test_late_detected():
    ks = detect_deterministic_keywords(SAMPLE["evidence"], load_keyword_vocabulary())
    assert [k["keyword"] for k in ks] == ["late_submission"]
    assert "9 working days" in ks[0]["plain_reason"] and "3 working days" in ks[0]["plain_reason"]


def test_all_pass_no_keywords():
    ev = copy.deepcopy(SAMPLE["evidence"])
    ev["checks"]["submission_window"]["satisfied"] = True
    assert detect_deterministic_keywords(ev, load_keyword_vocabulary()) == []


def test_other_deterministic_keywords():
    ev = copy.deepcopy(SAMPLE["evidence"])
    ev["checks"]["proof"]["provided"] = False
    ev["checks"]["proof"]["file_attached"] = False   # no document: "no proof provided"
    ev["checks"]["exam_type"]["excluded"] = True
    ev["checks"]["enrollment"]["found"] = False
    ids = {k["keyword"] for k in detect_deterministic_keywords(ev, load_keyword_vocabulary())}
    assert {"no_proof_provided", "excluded_exam_type", "no_enrollment_record", "late_submission"} == ids


# --- no_proof_provided follows the attached document, not the typed text ------

def _proof_evidence(**proof):
    ev = copy.deepcopy(SAMPLE["evidence"])
    ev["checks"]["submission_window"]["satisfied"] = True   # isolate the proof keyword
    ev["checks"]["proof"] = proof
    return ev


def _ids(ev):
    return [k["keyword"] for k in detect_deterministic_keywords(ev, load_keyword_vocabulary())]


def test_pdf_attached_with_empty_description_is_not_no_proof():
    # The reported case: the PDF was attached and read; the optional
    # description was left empty, so "provided" is False.
    ev = _proof_evidence(required=True, provided=False, raw_value=None, file_attached=True,
                         file_count=1, file_names=["test.pdf"], file_source="bucket", file_url=None)
    assert _ids(ev) == []


def test_no_pdf_attached_is_no_proof_even_with_a_description():
    for provided, raw in ((False, None), (True, "Medical report")):
        ev = _proof_evidence(required=True, provided=provided, raw_value=raw, file_attached=False,
                             file_count=0, file_names=[], file_source=None, file_url=None)
        assert _ids(ev) == ["no_proof_provided"], provided


def test_older_evidence_without_file_attached_keeps_the_original_rule():
    assert _ids(_proof_evidence(required=True, provided=False, raw_value=None)) == ["no_proof_provided"]
    assert _ids(_proof_evidence(required=True, provided=True, raw_value="Medical report")) == []
    assert _ids(_proof_evidence(required=True, provided=False, file_attached=None)) == ["no_proof_provided"]


def test_rejection_with_an_invalid_attached_document(monkeypatch):
    # An Agent 5 REJECT for an attached document it found invalid: only the AI
    # judgment keyword applies; the verified (deterministic) list stays empty.
    result = copy.deepcopy(SAMPLE)
    result["evidence"]["checks"]["submission_window"]["satisfied"] = True
    result["evidence"]["checks"]["proof"].update(provided=False, raw_value=None, file_attached=True, file_count=1)
    fake(monkeypatch, judgment_keywords=["proof_inconsistent_or_unverifiable"],
         suggested_reasons=[reason("The document you submitted could not be accepted.",
                                   ("proof_inconsistent_or_unverifiable",))])
    out = explain_rejection_workflow(result)
    assert out["deterministic_keywords"] == []
    assert out["judgment_keywords"] == ["proof_inconsistent_or_unverifiable"]
    assert out["suggested_reasons"][0]["addresses_keywords"] == ["proof_inconsistent_or_unverifiable"]


def test_agent5_proof_check_is_unchanged():
    # Agent 5's own check still reports the typed description as before.
    from app.agents.incomplete_exam.policy_checks import evaluate_incomplete_exam_request, get_incomplete_exam_policy
    base = {"Missed_Exam_Date": "2026-11-05", "Request_Date": "2026-11-08", "Exam_Type": "Final"}
    policy = get_incomplete_exam_policy()
    assert evaluate_incomplete_exam_request({**base, "Proof": ""}, policy)["proof"]["provided"] is False
    assert evaluate_incomplete_exam_request({**base, "Proof": "Medical report"}, policy)["proof"]["provided"] is True


def test_invalid_inputs():
    with pytest.raises(InvalidAgent5ResultError):
        validate_agent5_result({"recommendation": "REJECT"})
    with pytest.raises(InvalidAgent5ResultError):
        validate_agent5_result("not a dict")


def test_not_applicable_for_approve():
    r = copy.deepcopy(SAMPLE)
    r["recommendation"] = "APPROVE"
    assert explain_rejection_workflow(r)["status"] == "not_applicable"


def test_ok_path(monkeypatch):
    fake(monkeypatch, suggested_reasons=[reason()])
    out = explain_rejection_workflow(SAMPLE)
    assert out["status"] == "ok" and len(out["suggested_reasons"]) == 1


def test_unknown_keyword_dropped(monkeypatch):
    fake(monkeypatch, judgment_keywords=["made_up"], suggested_reasons=[reason()])
    assert explain_rejection_workflow(SAMPLE)["judgment_keywords"] == []


def test_reason_without_valid_keyword_dropped(monkeypatch):
    fake(monkeypatch, suggested_reasons=[reason(ids=("made_up",))])
    assert explain_rejection_workflow(SAMPLE)["status"] == "fallback"


def test_unsupported_number_dropped(monkeypatch):
    fake(monkeypatch, suggested_reasons=[reason("You were 47 working days late.")])
    out = explain_rejection_workflow(SAMPLE)
    assert out["status"] == "fallback" and "47" not in out["suggested_reasons"][0]["text"]


def test_gemini_error_fallback(monkeypatch):
    fake(monkeypatch, status="error", error="boom")
    out = explain_rejection_workflow(SAMPLE)
    assert out["status"] == "fallback" and "9 working days" in out["suggested_reasons"][0]["text"]


def test_needs_manual_explanation(monkeypatch):
    r = copy.deepcopy(SAMPLE)
    r["evidence"]["checks"]["submission_window"]["satisfied"] = True
    fake(monkeypatch, suggested_reasons=[])
    assert explain_rejection_workflow(r)["status"] == "needs_manual_explanation"


def test_unavailable(monkeypatch):
    r = copy.deepcopy(SAMPLE)
    r["evidence"]["checks"]["submission_window"]["satisfied"] = True
    fake(monkeypatch, status="unavailable", error="no key")
    assert explain_rejection_workflow(r)["status"] == "unavailable"


# --- Gemini call through the shared client --------------------------------------

@pytest.fixture
def keyed(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaSyFAKE-test-key-0123456789abcdefghij")
    get_settings.cache_clear()
    sleeps = []
    monkeypatch.setattr(gemini, "_sleep", sleeps.append)

    def install(outcomes):
        client = FakeClient(outcomes)
        monkeypatch.setattr(gemini, "get_client", lambda: client)
        return client.models, sleeps
    return install


def test_rules_are_unchanged():
    assert hashlib.sha256(gs._RULES.encode()).hexdigest() == RULES_SHA256
    assert gs.TEMPERATURE == 0.3 and gs.RETRY_DELAYS == (1, 2)


def test_no_key_is_unavailable():
    out = gs.get_rejection_suggestions({"request_id": "R"})
    assert out["status"] == "unavailable" and out["error"] == "GEMINI_API_KEY is not set."


def test_call_settings_and_model_recorded(keyed):
    models, _ = keyed([rejection_reply()])
    context = {"request_id": "STUD_INCRQ_INC2_900001", "facts": {"working_days_elapsed": 9}}
    with recording_calls() as calls:
        out = gs.get_rejection_suggestions(context)
    assert out["status"] == "ok" and len(out["suggested_reasons"]) == 3
    call = models.calls[0]
    assert call["contents"] == json.dumps(context, indent=2, default=str)
    assert call["config"].system_instruction == gs._RULES and call["config"].temperature == 0.3
    assert calls == [{"agent": "rejection", "model": "test-model"}]


def test_same_model_retried_like_the_standalone(keyed):
    models, sleeps = keyed([api_error(503), api_error(503), rejection_reply()])
    assert gs.get_rejection_suggestions({"request_id": "R"})["status"] == "ok"
    assert [c["model"] for c in models.calls] == ["test-model"] * 3 and sleeps == [1, 2]


def test_failure_becomes_error_status_and_templates(keyed):
    keyed([api_error(503)] * 3)
    out = gs.get_rejection_suggestions({"request_id": "R"})
    assert out["status"] == "error" and "503" in out["error"] and "AIzaSyFAKE" not in out["error"]

    keyed([api_error(400)])
    explained = explain_rejection_workflow(SAMPLE)
    assert explained["status"] == "fallback" and explained["gemini_status"] == "error"

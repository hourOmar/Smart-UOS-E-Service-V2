"""Agent 5's evidence and Gemini step: unchanged prompt text (pinned), no
student identity sent, attachments and configured fallbacks used, failures
raised instead of an invented MANUAL_REVIEW."""

import hashlib
import json

import pytest

from app.agents.incomplete_exam import eligibility_decision as decision
from app.agents.incomplete_exam.evidence import build_evidence_package
from app.agents.incomplete_exam.exceptions import InvalidRecommendationError
from app.agents.incomplete_exam.llm_calls import recording_calls
from app.config import get_settings
from app.core import gemini

from .fakes import PDF, REQUEST_ID, STUDENT_ID, STUDENT_NAME, FakeClient, api_error, decision_reply, request_data

# SHA-256 of the standalone texts (commit ef22d2f, app/services/gemini.py).
DECISION_RULES_SHA256 = "76521b07b91b7baa7563167bcb900fd299fa23092b820ef00c4e8567fd8e7b08"
ATTACHMENT_INSTRUCTIONS_SHA256 = "ebad3cfbbe12d8d999c95f78ddff9b9a95124cf38d691b636a802d941d1c3bdd"

FILES = [{"filename": "medical_report.pdf", "mime_type": "application/pdf", "data": PDF}]


def evidence(files=FILES, **kwargs):
    return build_evidence_package(REQUEST_ID, request_data(**kwargs), files)


@pytest.fixture
def client(monkeypatch):
    def install(outcomes):
        fake = FakeClient(outcomes)
        monkeypatch.setattr(gemini, "get_client", lambda: fake)
        return fake.models
    return install


def test_prompt_texts_are_unchanged():
    assert hashlib.sha256(decision._DECISION_RULES.encode()).hexdigest() == DECISION_RULES_SHA256
    assert hashlib.sha256(decision._ATTACHMENT_INSTRUCTIONS.encode()).hexdigest() == ATTACHMENT_INSTRUCTIONS_SHA256
    assert list(decision._IncompleteExamDecision.model_fields) == [
        "recommendation", "reasoning", "enrollment_explanation", "submission_window_explanation",
        "proof_explanation", "reason_validity_explanation", "exam_type_explanation"]


def test_evidence_package_has_the_standalone_keys():
    package = evidence()
    assert list(package) == ["request_id", "student", "course_id", "section_id", "term", "checks",
                             "reason_for_review", "policy_reference"]
    assert list(package["checks"]) == ["enrollment", "submission_window", "proof", "exam_type"]
    proof = package["checks"]["proof"]
    assert proof == {"required": True, "provided": True, "raw_value": "Medical report", "file_url": None,
                     "file_attached": True, "file_count": 1, "file_names": ["medical_report.pdf"],
                     "file_source": "bucket"}
    assert package["checks"]["submission_window"]["working_days_elapsed"] == 2
    assert package["student"] == {"Student_ID": STUDENT_ID, "Student_Name": STUDENT_NAME}


def test_no_files_and_no_enrollment():
    package = evidence(files=[], enrollment=False)
    assert package["checks"]["proof"]["file_attached"] is False and package["checks"]["proof"]["file_source"] is None
    assert package["checks"]["enrollment"] == {"found": False, "record": None}


def test_gemini_never_sees_the_student_identity():
    package = evidence()
    prompt = decision.build_prompt(package, has_attachments=True)
    assert STUDENT_NAME not in prompt and STUDENT_ID not in prompt
    assert '"Grade": null' in prompt and '"student"' not in prompt
    assert package["student"]["Student_Name"] == STUDENT_NAME                       # stored evidence unchanged
    assert package["checks"]["enrollment"]["record"]["Student_ID"] == STUDENT_ID


def test_prompt_is_assembled_as_before():
    package = evidence()
    view = decision.gemini_evidence(package)
    with_files = decision.build_prompt(package, has_attachments=True)
    assert with_files == (decision._DECISION_RULES + decision._ATTACHMENT_INSTRUCTIONS + "\n\nEvidence:\n"
                          + json.dumps(view, indent=2, default=str))
    without = decision.build_prompt(package, has_attachments=False)
    assert decision._ATTACHMENT_INSTRUCTIONS not in without


def test_decision_sends_documents_and_maps_the_reply(client):
    models = client([decision_reply("APPROVE")])
    with recording_calls() as calls:
        result = decision.get_gemini_decision(evidence(), attachments=FILES)
    assert result == {
        "recommendation": "APPROVE", "reasoning": "Synthetic reasoning.",
        "checks": {"enrollment": "Enrolled.", "submission_window": "Filed within the window.",
                   "proof": "The attached document was reviewed.", "reason_validity": "Synthetic.",
                   "exam_type": "Midterm is not excluded."},
        "status": "ok", "error": None, "model": "test-model",
    }
    call = models.calls[0]
    assert call["model"] == "test-model" and isinstance(call["contents"], list)
    assert decision._ATTACHMENT_INSTRUCTIONS in call["contents"][0]
    assert call["contents"][1].inline_data.data == PDF
    assert call["contents"][1].inline_data.mime_type == "application/pdf"
    assert calls == [{"agent": "eligibility", "model": "test-model"}]


def test_without_documents_the_prompt_alone_is_sent(client):
    models = client([decision_reply("MANUAL_REVIEW")])
    decision.get_gemini_decision(evidence(files=[]), attachments=None)
    assert isinstance(models.calls[0]["contents"], str)


def test_configured_fallback_models_are_used(client, monkeypatch):
    monkeypatch.setenv("GEMINI_FALLBACK_MODELS", "fallback-a, fallback-b")
    get_settings.cache_clear()
    models = client([api_error(503), api_error(429), decision_reply("REJECT")])
    result = decision.get_gemini_decision(evidence(), attachments=FILES)
    assert [c["model"] for c in models.calls] == ["test-model", "fallback-a", "fallback-b"]
    assert result["model"] == "fallback-b"
    assert all(c["contents"][1].inline_data.data == PDF for c in models.calls)


def test_gemini_failure_raises_instead_of_manual_review(client):
    client([api_error(503)])
    with pytest.raises(gemini.GeminiUnavailableError):
        decision.get_gemini_decision(evidence(), attachments=FILES)


def test_missing_key_is_a_failure_not_manual_review():
    with pytest.raises(gemini.GeminiUnavailableError):   # conftest: GEMINI_API_KEY is empty
        decision.get_gemini_decision(evidence(), attachments=FILES)


@pytest.mark.parametrize("value", ["Approve", "REQUIRES_REVIEW", "", "APPROVE."])
def test_unsupported_recommendation_is_refused(client, value):
    client([decision_reply(value)])
    with pytest.raises(InvalidRecommendationError):
        decision.get_gemini_decision(evidence(), attachments=FILES)

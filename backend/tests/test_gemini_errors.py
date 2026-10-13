import logging

import httpx
import pytest
from google.genai import errors as genai_errors

from app.agents.raise_capacity_eligibility import decision
from app.agents.raise_capacity_eligibility.schemas import EligibilityDecision
from app.config import get_settings
from app.core import gemini

FAKE_KEY = "AIzaSyFAKE-test-key-0123456789abcdefghij"
EVIDENCE = {
    "request_id": "STUD_RSCA_RSCA_000001",
    "student": {"Student_ID": "U21100001", "Student_Name": "Zaynab Distinctname"},
    "checks": {"prerequisite": {}, "completed_hours": {}, "capacity": {}},
}


class FailingModels:
    def __init__(self, exc):
        self.exc = exc

    def generate_content(self, **kwargs):
        raise self.exc


class FakeClient:
    def __init__(self, exc):
        self.models = FailingModels(exc)


@pytest.fixture
def with_key(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", FAKE_KEY)
    get_settings.cache_clear()


def server_error(message):
    return genai_errors.ServerError(503, {"error": {"code": 503, "message": message, "status": "UNAVAILABLE"}})


def test_describe_failure_keeps_status_code_and_cause():
    text = gemini.describe_failure(server_error("The model is overloaded. Please try again later."))
    assert text == "ServerError 503 UNAVAILABLE: The model is overloaded. Please try again later."


def test_sanitize_removes_credentials_and_personal_data(with_key):
    text = gemini.sanitize(
        f"bad {FAKE_KEY} url?key=abc123&x=1 Authorization: Bearer eyJhbGciOi.payload.sig "
        "mail U21100001@sharjah.ac.ae id U21100001 other AIzaSyOTHERKEY0123456789abcdefgh"
    )
    for secret in (FAKE_KEY, "abc123", "eyJhbGciOi", "U21100001", "sharjah.ac.ae", "AIzaSyOTHER"):
        assert secret not in text
    assert "[redacted]" in text and "[email]" in text


def test_long_messages_are_truncated():
    assert len(gemini.sanitize("x" * 5000)) <= 300


def test_server_error_is_stored_and_logged_with_status_and_cause_only(with_key, monkeypatch, caplog):
    exc = server_error(f"The model is overloaded. key={FAKE_KEY} for U21100001")
    monkeypatch.setattr(gemini, "get_client", lambda: FakeClient(exc))
    with caplog.at_level(logging.WARNING, logger="app.core.gemini"):
        result = decision.get_decision(EVIDENCE)

    stored = result["error"]
    assert result["status"] == "unavailable" and result["recommendation"] == "MANUAL_REVIEW"
    assert stored.startswith("Gemini request failed: ServerError 503 UNAVAILABLE: The model is overloaded.")
    logged = caplog.text
    assert "503 UNAVAILABLE" in logged and "request STUD_RSCA_RSCA_000001" in logged and "model=" in logged
    for leaked in (FAKE_KEY, "U21100001", "Distinctname", "Verified evidence", "DECISION RULES"):
        assert leaked not in stored and leaked not in logged


def test_network_error_keeps_type_and_message(with_key, monkeypatch, caplog):
    monkeypatch.setattr(gemini, "get_client", lambda: FakeClient(httpx.ConnectTimeout("timed out")))
    with caplog.at_level(logging.WARNING, logger="app.core.gemini"):
        with pytest.raises(gemini.GeminiUnavailableError) as raised:
            gemini.generate_structured("prompt text", EligibilityDecision, model="m")
    assert str(raised.value) == "Gemini request failed: ConnectTimeout: timed out"
    assert "prompt text" not in caplog.text


def test_unparseable_reply_reports_finish_reason(with_key, monkeypatch):
    class Candidate:
        finish_reason = "MAX_TOKENS"

    class Response:
        parsed = None
        candidates = [Candidate()]

    class Models:
        def generate_content(self, **kwargs):
            return Response()

    class Client:
        models = Models()

    monkeypatch.setattr(gemini, "get_client", lambda: Client())
    with pytest.raises(gemini.GeminiUnavailableError, match="MAX_TOKENS"):
        gemini.generate_structured("p", EligibilityDecision, model="m")

"""llm_client.py: V2 models in order, next model only after 5xx, 429 or 404,
an empty reply stops at once, sanitized failures, models recorded (contract section 7)."""

import pytest

from app.agents.course_substitution_eligibility import llm_client
from app.core import gemini
from app.core.gemini import GeminiUnavailableError

from .fakes import FAKE_KEY, STUDENT_ID, api_error, install_fake_gemini


def test_models_come_from_settings_in_order(monkeypatch):
    models = install_fake_gemini(monkeypatch, api_error(503), api_error(429), "answer", fallback_models="fb-1, fb-2")
    assert llm_client.configured_models() == ["test-model", "fb-1", "fb-2"]
    response = llm_client.generate_with_fallback("prompt")
    assert (response.text, response.model) == ("answer", "fb-2")
    assert [c["model"] for c in models.calls] == ["test-model", "fb-1", "fb-2"]
    assert all(c["config"] is None for c in models.calls)


@pytest.mark.parametrize("code", [500, 502, 503, 504, 429, 404])
def test_next_model_after_server_error_rate_limit_or_unavailable_model(monkeypatch, code):
    models = install_fake_gemini(monkeypatch, api_error(code), "ok", fallback_models="fb-1")
    assert llm_client.generate_with_fallback("p").model == "fb-1"
    assert len(models.calls) == 2


@pytest.mark.parametrize("code", [400, 401, 403])
def test_other_client_errors_stop(monkeypatch, code):
    models = install_fake_gemini(monkeypatch, api_error(code), "never", fallback_models="fb-1")
    with pytest.raises(GeminiUnavailableError):
        llm_client.generate_with_fallback("p")
    assert len(models.calls) == 1


def test_non_api_exception_stops(monkeypatch):
    models = install_fake_gemini(monkeypatch, ConnectionError("network down"), "never", fallback_models="fb-1")
    with pytest.raises(GeminiUnavailableError, match="ConnectionError: network down"):
        llm_client.generate_with_fallback("p")
    assert len(models.calls) == 1


@pytest.mark.parametrize("reply", ["", None])
def test_empty_reply_stops_without_trying_the_next_model(monkeypatch, reply):
    models = install_fake_gemini(monkeypatch, reply, "never", fallback_models="fb-1")
    with pytest.raises(GeminiUnavailableError, match="Gemini model test-model returned an empty response."):
        llm_client.generate_with_fallback("p")
    assert len(models.calls) == 1


def test_every_model_failing_names_each_model_sanitized(monkeypatch):
    leak = f"quota key={FAKE_KEY} {STUDENT_ID}"
    install_fake_gemini(monkeypatch, api_error(503, leak), api_error(429, leak), fallback_models="fb-1")
    with pytest.raises(GeminiUnavailableError) as raised:
        llm_client.generate_with_fallback("p")
    message = str(raised.value)
    assert message.startswith("Gemini request failed on every configured model: test-model: ServerError 503")
    assert "; fb-1: ClientError 429" in message
    assert FAKE_KEY not in message and STUDENT_ID not in message


def test_missing_key_is_a_gemini_unavailable_error(monkeypatch):
    # The real shared client, with no key configured (tests/conftest.py).
    monkeypatch.setattr(gemini, "_client", None)
    with pytest.raises(GeminiUnavailableError, match="GEMINI_API_KEY is not configured."):
        llm_client.generate_with_fallback("p")


def test_url_context_and_recording(monkeypatch):
    models = install_fake_gemini(monkeypatch, "a", "b")
    with llm_client.recording_calls() as calls:
        llm_client.generate_with_fallback("p", use_url_context=True)
        llm_client.generate_with_fallback("p")
    assert calls == [{"model": "test-model", "use_url_context": True},
                     {"model": "test-model", "use_url_context": False}]
    assert models.calls[0]["config"].tools[0].url_context is not None
    assert models.calls[1]["config"] is None


def test_failed_calls_are_not_recorded(monkeypatch):
    install_fake_gemini(monkeypatch, api_error(400))
    with llm_client.recording_calls() as calls:
        with pytest.raises(GeminiUnavailableError):
            llm_client.generate_with_fallback("p")
    assert calls == []

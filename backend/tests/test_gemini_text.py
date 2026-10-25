"""app.core.gemini.generate_text_with_fallback: plain-text replies, the optional
URL context tool, the model order and fallback rule, and sanitized failures.
No real Gemini calls."""

import pytest

from app.config import get_settings
from app.core import gemini
from app.core.gemini import GeminiUnavailableError, generate_text_with_fallback
from program_change.fakes import FakeTextModels, client_error, server_error

FAKE_KEY = "AIzaSyFAKE-test-key-0123456789abcdefghij"


@pytest.fixture
def fake_models(monkeypatch):
    def install(*behaviours):
        models = FakeTextModels(behaviours)
        monkeypatch.setattr(gemini, "get_client", lambda: type("Client", (), {"models": models})())
        return models
    return install


def test_returns_text_and_the_model_that_answered(fake_models):
    models = fake_models("plain text")
    assert generate_text_with_fallback("prompt", ["m1", "m2"]) == ("plain text", "m1")
    assert models.calls == [{"model": "m1", "contents": "prompt", "config": None}]


def test_url_context_tool_only_when_asked(fake_models):
    models = fake_models("a", "b")
    generate_text_with_fallback("p", ["m1"], use_url_context=True)
    generate_text_with_fallback("p", ["m1"])
    with_tool, without = models.calls
    assert with_tool["config"].tools[0].url_context is not None
    assert with_tool["config"].response_schema is None
    assert without["config"] is None


def test_empty_or_missing_text_is_returned_for_the_caller_to_check(fake_models):
    fake_models("", None)
    assert generate_text_with_fallback("p", ["m1"]) == ("", "m1")
    assert generate_text_with_fallback("p", ["m1"]) == (None, "m1")


def test_default_rule_falls_back_only_after_429_or_503(fake_models):
    models = fake_models(server_error(503), client_error(429, "RESOURCE_EXHAUSTED"), "ok")
    assert generate_text_with_fallback("p", ["m1", "m2", "m3"]) == ("ok", "m3")
    models = fake_models(server_error(500, "INTERNAL"))
    with pytest.raises(GeminiUnavailableError, match="500"):
        generate_text_with_fallback("p", ["m1", "m2"])
    assert [c["model"] for c in models.calls] == ["m1"]


def test_custom_rule_decides_what_is_temporary(fake_models):
    models = fake_models(server_error(500, "INTERNAL"), "ok")
    text, model = generate_text_with_fallback("p", ["m1", "m2"], is_temporary=lambda e: e.code >= 500)
    assert (text, model) == ("ok", "m2") and len(models.calls) == 2


def test_other_errors_stop_at_once(fake_models):
    models = fake_models(client_error(400))
    with pytest.raises(GeminiUnavailableError, match="400"):
        generate_text_with_fallback("p", ["m1", "m2"], is_temporary=lambda e: e.code == 503)
    assert len(models.calls) == 1


def test_every_model_failing_names_each_model(fake_models):
    fake_models(server_error(), server_error())
    with pytest.raises(GeminiUnavailableError) as excinfo:
        generate_text_with_fallback("p", ["m1", "m2"])
    assert "every configured model" in str(excinfo.value)
    assert "m1:" in str(excinfo.value) and "m2:" in str(excinfo.value)


def test_failure_messages_never_contain_the_key(monkeypatch, fake_models):
    monkeypatch.setenv("GEMINI_API_KEY", FAKE_KEY)
    get_settings.cache_clear()
    fake_models(RuntimeError(f"connection failed for key={FAKE_KEY}"))
    with pytest.raises(GeminiUnavailableError) as excinfo:
        generate_text_with_fallback("p", ["m1"])
    assert FAKE_KEY not in str(excinfo.value)


def test_at_least_one_model_is_required():
    with pytest.raises(ValueError):
        generate_text_with_fallback("p", [])

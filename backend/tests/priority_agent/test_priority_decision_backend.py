"""The ported Gemini decision on app.core.gemini: prompt content, structured output,
optional fallback models (temporary 429/503 errors only), and that the
eligibility agent's single-model behaviour is unchanged. No real Gemini calls."""

import json
from types import SimpleNamespace

import pytest
from google.genai import errors as genai_errors
from pydantic import BaseModel, ValidationError

from app.agents.raise_capacity_priority.pipeline.gemini_prompt import SYSTEM_INSTRUCTION, build_gemini_prompt
from app.agents.raise_capacity_priority.pipeline.get_priority_decision import get_priority_decision
from app.config import get_settings
from app.core import gemini
from priority_agent.test_gemini_prompt import POLICY, _evidence

VALID = {
    "priority": "MEDIUM",
    "reasoning": "Because of the evidence.",
    "factor_explanations": {
        "graduation": "g", "degree_progress": "d", "course_requirement": "c", "course_availability": "a",
        "previous_attempts": "p", "prerequisite": "pr", "progression": "prog",
    },
    "key_evidence": ["Remaining credits: 33"],
}


class FakeModels:
    """Mimics google-genai: `parsed` is the reply validated against the requested
    schema, or None when it does not validate."""

    def __init__(self, behaviours):
        self.behaviours = list(behaviours)
        self.calls = []

    def generate_content(self, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        if not self.behaviours:
            raise AssertionError("more Gemini calls than configured")
        behaviour = self.behaviours.pop(0)
        if isinstance(behaviour, Exception):
            raise behaviour
        try:
            parsed = config.response_schema.model_validate_json(behaviour)
        except (ValidationError, ValueError):
            parsed = None
        return SimpleNamespace(text=behaviour, parsed=parsed, candidates=[])


@pytest.fixture
def fake_gemini(monkeypatch):
    def install(*behaviours, fallbacks=""):
        monkeypatch.setenv("GEMINI_FALLBACK_MODELS", fallbacks)
        get_settings.cache_clear()
        client = SimpleNamespace(models=FakeModels(behaviours))
        monkeypatch.setattr(gemini, "get_client", lambda: client)
        return client.models
    return install


def server_error():
    return genai_errors.ServerError(503, {"message": "The model is overloaded.", "status": "UNAVAILABLE"})


def rate_limit():
    return genai_errors.ClientError(429, {"message": "Resource exhausted.", "status": "RESOURCE_EXHAUSTED"})


def client_error(code):
    return genai_errors.ClientError(code, {"message": "No.", "status": "INVALID_ARGUMENT"})


# -- prompt ------------------------------------------------------------------------

def test_prompt_leaves_out_the_student_id_but_keeps_the_justification():
    system, content = build_gemini_prompt(_evidence(reason="Final semester; I need it."), POLICY)
    assert system == SYSTEM_INSTRUCTION
    assert '"student_id"' not in content and '"S1"' not in content
    assert "Final semester; I need it." in content and '"request_id": "REQ-1"' in content
    assert json.dumps(POLICY, indent=2) in content


def test_decision_sends_the_system_instruction_schema_and_model(fake_gemini):
    models = fake_gemini(json.dumps(VALID))
    decision, model = get_priority_decision(_evidence(), POLICY)
    assert decision.priority == "MEDIUM" and model == "test-model"
    config = models.calls[0]["config"]
    assert config.system_instruction == SYSTEM_INSTRUCTION
    assert config.response_mime_type == "application/json"
    assert config.response_schema.__name__ == "PriorityDecision"
    assert '"student_id"' not in models.calls[0]["contents"]


# -- invalid replies and technical failures are errors, never a priority -----------

@pytest.mark.parametrize("reply", [
    "", "{not json", json.dumps({**VALID, "priority": "URGENT"}), json.dumps({**VALID, "reasoning": ""}),
    json.dumps({**VALID, "factor_explanations": {k: v for k, v in VALID["factor_explanations"].items()
                                                 if k != "progression"}}),
])
def test_invalid_reply_raises(fake_gemini, reply):
    fake_gemini(reply)
    with pytest.raises(gemini.GeminiUnavailableError):
        get_priority_decision(_evidence(), POLICY)


def test_network_failure_raises_and_never_becomes_manual_review(fake_gemini):
    fake_gemini(TimeoutError("simulated timeout"))
    with pytest.raises(gemini.GeminiUnavailableError):
        get_priority_decision(_evidence(), POLICY)


def test_missing_api_key_raises(monkeypatch):
    monkeypatch.setattr(gemini, "_client", None)
    with pytest.raises(gemini.GeminiUnavailableError, match="GEMINI_API_KEY"):
        get_priority_decision(_evidence(), POLICY)


# -- fallback models ------------------------------------------------------------------

@pytest.mark.parametrize("temporary", [server_error, rate_limit])
def test_temporary_error_tries_the_next_configured_model(fake_gemini, temporary):
    models = fake_gemini(temporary(), json.dumps(VALID), fallbacks="fallback-1, fallback-2")
    decision, model = get_priority_decision(_evidence(), POLICY)
    assert decision.priority == "MEDIUM" and model == "fallback-1"
    assert [c["model"] for c in models.calls] == ["test-model", "fallback-1"]


def test_fallbacks_continue_through_the_list(fake_gemini):
    models = fake_gemini(server_error(), rate_limit(), json.dumps(VALID), fallbacks="fallback-1,fallback-2")
    assert get_priority_decision(_evidence(), POLICY)[1] == "fallback-2"
    assert len(models.calls) == 3


@pytest.mark.parametrize("error", [client_error(400), client_error(401), client_error(403),
                                   ConnectionError("network down")])
def test_other_errors_stop_immediately(fake_gemini, error):
    models = fake_gemini(error, fallbacks="fallback-1")
    with pytest.raises(gemini.GeminiUnavailableError):
        get_priority_decision(_evidence(), POLICY)
    assert len(models.calls) == 1


def test_all_models_failing_names_every_model(fake_gemini):
    fake_gemini(server_error(), rate_limit(), server_error(), fallbacks="fallback-1,fallback-2")
    with pytest.raises(gemini.GeminiUnavailableError) as raised:
        get_priority_decision(_evidence(), POLICY)
    message = str(raised.value)
    assert "every configured model" in message
    assert all(name in message for name in ("test-model", "fallback-1", "fallback-2"))


def test_invalid_reply_from_a_fallback_is_not_retried(fake_gemini):
    models = fake_gemini(server_error(), "{not json", fallbacks="fallback-1,fallback-2")
    with pytest.raises(gemini.GeminiUnavailableError):
        get_priority_decision(_evidence(), POLICY)
    assert len(models.calls) == 2


def test_no_fallback_configured_means_one_call(fake_gemini):
    models = fake_gemini(server_error())
    with pytest.raises(gemini.GeminiUnavailableError) as raised:
        get_priority_decision(_evidence(), POLICY)
    assert len(models.calls) == 1
    assert str(raised.value).startswith("Gemini request failed: ServerError 503 UNAVAILABLE")


# -- the eligibility agent's calls are unchanged ----------------------------------------

class Tiny(BaseModel):
    value: int


def test_generate_structured_never_uses_fallbacks_even_when_configured(fake_gemini):
    models = fake_gemini(server_error(), fallbacks="fallback-1")
    with pytest.raises(gemini.GeminiUnavailableError) as raised:
        gemini.generate_structured("prompt", Tiny)
    assert len(models.calls) == 1
    assert str(raised.value).startswith("Gemini request failed: ServerError 503 UNAVAILABLE")
    assert models.calls[0]["config"].system_instruction is None


def test_generate_structured_success_is_unchanged(fake_gemini):
    models = fake_gemini('{"value": 3}', fallbacks="fallback-1")
    assert gemini.generate_structured("prompt", Tiny).value == 3
    assert models.calls[0]["model"] == "test-model"

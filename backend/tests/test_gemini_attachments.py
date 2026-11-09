"""app.core.gemini attachments, temperature and same-model retries; existing
calls (no attachments) must be built exactly as before."""

import logging
from types import SimpleNamespace

import pytest
from google.genai import errors as genai_errors
from pydantic import BaseModel

from app.core import gemini

PDF = b"%PDF-1.7\nsynthetic proof document\n%%EOF"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24


class Reply(BaseModel):
    value: str


OK = {"value": "ok"}


def api_error(code):
    body = {"error": {"code": code, "message": f"synthetic {code}", "status": "X"}}
    return (genai_errors.ServerError if code >= 500 else genai_errors.ClientError)(code, body)


class Models:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def generate_content(self, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return SimpleNamespace(parsed=config.response_schema(**outcome), candidates=[])


@pytest.fixture
def client(monkeypatch):
    sleeps = []
    monkeypatch.setattr(gemini, "_sleep", sleeps.append)

    def install(outcomes):
        models = Models(outcomes)
        monkeypatch.setattr(gemini, "get_client", lambda: SimpleNamespace(models=models))
        return models, sleeps
    return install


def test_without_attachments_the_call_is_unchanged(client):
    models, _ = client([OK])
    parsed, model = gemini.generate_structured_with_model("the prompt", Reply, model="m")
    assert parsed.value == "ok" and model == "m"
    call = models.calls[0]
    assert call["contents"] == "the prompt"
    assert call["config"].temperature is None and call["config"].system_instruction is None
    assert call["config"].response_schema is Reply


def test_attachments_follow_the_prompt(client):
    models, _ = client([OK])
    gemini.generate_structured_with_model(
        "p", Reply, model="m",
        attachments=[gemini.Attachment("application/pdf", PDF), gemini.Attachment("image/png", PNG)])
    contents = models.calls[0]["contents"]
    assert contents[0] == "p" and len(contents) == 3
    assert (contents[1].inline_data.mime_type, contents[1].inline_data.data) == ("application/pdf", PDF)
    assert (contents[2].inline_data.mime_type, contents[2].inline_data.data) == ("image/png", PNG)


def test_attachment_validation():
    with pytest.raises(ValueError):
        gemini.Attachment("text/html", b"<html>")
    with pytest.raises(ValueError):
        gemini.Attachment("application/pdf", b"")
    assert "PDF" not in repr(gemini.Attachment("application/pdf", PDF))


def test_attachments_must_be_attachment_values(client):
    client([OK])
    with pytest.raises(TypeError):
        gemini.generate_structured_with_model("p", Reply, model="m", attachments=[{"mime_type": "application/pdf"}])


def test_temperature_is_passed_when_given(client):
    models, _ = client([OK])
    gemini.generate_structured_with_model("p", Reply, model="m", temperature=0.3)
    assert models.calls[0]["config"].temperature == 0.3


def test_same_model_retry_then_success(client):
    models, sleeps = client([api_error(503), OK])
    attachment = gemini.Attachment("application/pdf", PDF)
    _, model = gemini.generate_structured_with_model("p", Reply, model="m", retry_delays=(1, 2),
                                                     attachments=[attachment])
    assert model == "m" and sleeps == [1] and [c["model"] for c in models.calls] == ["m", "m"]
    assert all(c["contents"][1].inline_data.data == PDF for c in models.calls)


def test_retries_then_fallback_models(client):
    models, sleeps = client([api_error(503), api_error(429), api_error(503), OK])
    _, model = gemini.generate_structured_with_model("p", Reply, model="m", fallback_models=("f",),
                                                     retry_delays=(1, 2))
    assert model == "f" and sleeps == [1, 2] and [c["model"] for c in models.calls] == ["m", "m", "m", "f"]


def test_non_temporary_error_is_not_retried(client):
    models, sleeps = client([api_error(400)])
    with pytest.raises(gemini.GeminiUnavailableError):
        gemini.generate_structured_with_model("p", Reply, model="m", fallback_models=("f",), retry_delays=(1, 2))
    assert len(models.calls) == 1 and sleeps == []


def test_every_model_failing_lists_them(client):
    client([api_error(503), api_error(503)])
    with pytest.raises(gemini.GeminiUnavailableError, match="every configured model") as raised:
        gemini.generate_structured_with_model("p", Reply, model="m", fallback_models=("f",))
    assert "m:" in str(raised.value) and "f:" in str(raised.value)


def test_logs_never_contain_the_prompt_or_document(client, caplog):
    client([api_error(503), api_error(400)])
    with caplog.at_level(logging.INFO, logger="app.core.gemini"):
        with pytest.raises(gemini.GeminiUnavailableError):
            gemini.generate_structured_with_model(
                "secret prompt text", Reply, model="m", retry_delays=(1,),
                attachments=[gemini.Attachment("application/pdf", PDF)])
    assert "secret prompt text" not in caplog.text and "synthetic proof document" not in caplog.text

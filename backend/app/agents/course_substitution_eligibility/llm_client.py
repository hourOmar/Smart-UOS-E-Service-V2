"""Gemini calls for the Course Substitution agent, through app.core.gemini.

Replaces the standalone services/llm_client.py, which read GEMINI_API_KEY and
built its own genai.Client at import time, printed each attempt and tried a
hard-coded list of six models.

Kept unchanged: the fallback rule -- a server error (HTTP 5xx), a rate limit
(429) or an unavailable model (404) moves on to the next model, any other
error stops at once -- and a reply with empty text stops at once (it is never
retried on the next model). Callers still read `response.text`.

Changes: the models are GEMINI_MODEL, then GEMINI_FALLBACK_MODELS (backend
settings, read when a call is made); the shared client is used; attempts are
logged instead of printed; and every failure raises
app.core.gemini.GeminiUnavailableError with a sanitized message.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

from google.genai import errors

from app.core.gemini import GeminiUnavailableError, fallback_model_names, generate_text_with_fallback, model_name

# HTTP codes of client errors after which the next model is tried.
NEXT_MODEL_CLIENT_CODES = frozenset({404, 429})


def configured_models() -> list[str]:
    """GEMINI_MODEL, then each GEMINI_FALLBACK_MODELS entry, in order."""
    return [model_name(), *fallback_model_names()]


def is_model_availability_error(error: errors.APIError) -> bool:
    """Errors after which the next model is tried: any server error (5xx),
    a rate limit (429) or an unavailable model (404), as in the standalone agent."""
    return isinstance(error, errors.ServerError) or getattr(error, "code", None) in NEXT_MODEL_CLIENT_CODES


@dataclass(frozen=True)
class GeminiResponse:
    text: str
    model: str


_calls: ContextVar[list[dict] | None] = ContextVar("course_substitution_gemini_calls", default=None)


@contextmanager
def recording_calls() -> Iterator[list[dict]]:
    """Collects {"model", "use_url_context"} for every Gemini call answered
    inside the block (workflow.py stores the model names with the run)."""
    calls: list[dict] = []
    token = _calls.set(calls)
    try:
        yield calls
    finally:
        _calls.reset(token)


def generate_with_fallback(prompt, use_url_context=False):
    """Generate a Gemini response, trying the configured models in order."""
    text, model = generate_text_with_fallback(
        prompt,
        configured_models(),
        use_url_context=use_url_context,
        is_temporary=is_model_availability_error,
        context="course substitution",
    )
    if not text:
        raise GeminiUnavailableError(f"Gemini model {model} returned an empty response.")
    recorder = _calls.get()
    if recorder is not None:
        recorder.append({"model": model, "use_url_context": use_url_context})
    return GeminiResponse(text=text, model=model)

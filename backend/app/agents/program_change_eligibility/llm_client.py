"""Gemini calls for the Program Change agent, through app.core.gemini.

Replaces the standalone llm_client.py, which built its own genai.Client from
GEMINI_API_KEY at import time and printed each attempt. Kept unchanged: the
model list and its order, the URL context option, and the fallback rule --
a server error (HTTP 5xx) or a rate limit (429) moves on to the next model,
any other error stops at once. Callers still read `response.text`.

Differences, from using the shared client: the key comes from the backend
settings (backend/.env), attempts are logged instead of printed, and a
failure raises app.core.gemini.GeminiUnavailableError with a sanitized
message instead of the raw google-genai error or RuntimeError.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

from google.genai import errors

from app.core.gemini import generate_text_with_fallback

# Models are ordered from preferred to fallback.
GEMINI_MODELS = [
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
]


def is_model_availability_error(error: errors.APIError) -> bool:
    """Temporary availability errors after which the next model is tried:
    any server error (5xx) and rate limits (429), as in the standalone agent."""
    return isinstance(error, errors.ServerError) or getattr(error, "code", None) == 429


@dataclass(frozen=True)
class GeminiResponse:
    text: str | None
    model: str


_calls: ContextVar[list[dict] | None] = ContextVar("program_change_gemini_calls", default=None)


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
    """Generate a Gemini response, trying GEMINI_MODELS in order."""
    text, model = generate_text_with_fallback(
        prompt,
        GEMINI_MODELS,
        use_url_context=use_url_context,
        is_temporary=is_model_availability_error,
        context="program change",
    )
    recorder = _calls.get()
    if recorder is not None:
        recorder.append({"model": model, "use_url_context": use_url_context})
    return GeminiResponse(text=text, model=model)

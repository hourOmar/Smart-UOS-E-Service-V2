"""The one Gemini client module every agent uses.

Agents pass a prompt and a Pydantic schema; the reply is requested as JSON matching
that schema (structured output), so it is never free-form text to re-parse.
"""

import logging
import re
import threading
import time
from collections.abc import Callable, Sequence

from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel

from app.config import get_settings

log = logging.getLogger(__name__)

_MAX_DETAIL = 300


class GeminiUnavailableError(Exception):
    """Gemini is not configured, could not be reached, or returned no usable reply.
    Its message is sanitized (see describe_failure) and safe to store and show."""


def sanitize(text: str | None) -> str:
    """Removes anything credential- or person-like from an error text: the
    configured API key, key=/token= parameters, bearer tokens, Google API keys,
    email addresses and UoS student IDs. Collapses whitespace and truncates."""
    if not text:
        return ""
    value = str(text)
    api_key = get_settings().gemini_api_key
    if api_key:
        value = value.replace(api_key, "[redacted]")
    value = re.sub(r"(?i)\b(key|api_key|apikey|token|access_token)=[^&\s'\"]+", r"\1=[redacted]", value)
    value = re.sub(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [redacted]", value)
    value = re.sub(r"AIza[0-9A-Za-z_-]{20,}", "[redacted]", value)
    value = re.sub(r"[\w.+-]+@[\w-]+(\.[\w-]+)+", "[email]", value)
    value = re.sub(r"\bU\d{7,9}\b", "[student-id]", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value if len(value) <= _MAX_DETAIL else value[: _MAX_DETAIL - 1] + "…"


def describe_failure(exc: BaseException) -> str:
    """'ServerError 503 UNAVAILABLE: The model is overloaded…' for API errors;
    the exception type and its sanitized message otherwise."""
    kind = type(exc).__name__
    if isinstance(exc, genai_errors.APIError):
        status = " ".join(str(part) for part in (exc.code, exc.status) if part)
        detail = sanitize(exc.message)
        return f"{kind} {status}".strip() + (f": {detail}" if detail else "")
    detail = sanitize(str(exc))
    return f"{kind}: {detail}" if detail else kind


_client = None
_client_lock = threading.Lock()


def get_client() -> genai.Client:
    global _client
    with _client_lock:
        if _client is None:
            api_key = get_settings().gemini_api_key
            if not api_key:
                raise GeminiUnavailableError("GEMINI_API_KEY is not configured.")
            _client = genai.Client(api_key=api_key)
        return _client


def model_name() -> str:
    return get_settings().gemini_model


def fallback_model_names() -> tuple[str, ...]:
    return get_settings().gemini_fallback_models


# Temporary errors after which the next configured fallback model is tried.
_TEMPORARY_STATUS_CODES = frozenset({429, 503})


class _TemporaryFailure(Exception):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


def generate_structured[T: BaseModel](
    prompt: str, schema: type[T], *, model: str | None = None, context: str = "",
    system_instruction: str | None = None,
) -> T:
    """Returns the reply parsed into `schema`, or raises GeminiUnavailableError.
    Failures are logged (sanitized: never the prompt, key or reply text);
    `context` is a short non-personal label for the log, e.g. a request ID."""
    return generate_structured_with_model(
        prompt, schema, model=model, context=context, system_instruction=system_instruction,
    )[0]


def generate_structured_with_model[T: BaseModel](
    prompt: str, schema: type[T], *, model: str | None = None, context: str = "",
    system_instruction: str | None = None, fallback_models: tuple[str, ...] | list[str] = (),
) -> tuple[T, str]:
    """generate_structured, also returning the model that answered.

    `fallback_models` are tried in order, each only after the previous model
    failed with a temporary error (HTTP 429 or 503). Any other failure, or an
    unusable reply, raises at once. With no fallbacks this is exactly
    generate_structured."""
    models = [model or model_name(), *fallback_models]
    temporary: list[str] = []
    for index, current in enumerate(models):
        try:
            return _generate_once(prompt, schema, current, context, system_instruction), current
        except _TemporaryFailure as failure:
            temporary.append(f"{current}: {failure.detail}")
            if index == len(models) - 1:
                message = (f"Gemini request failed: {failure.detail}" if len(models) == 1 else
                           "Gemini request failed on every configured model: " + "; ".join(temporary))
                raise GeminiUnavailableError(message) from failure.__cause__
            log.info("Trying the next Gemini model after a temporary error (model=%s%s)",
                     current, f", {context}" if context else "")
    raise AssertionError("unreachable")  # pragma: no cover


def _generate_once[T: BaseModel](
    prompt: str, schema: type[T], model: str, context: str, system_instruction: str | None,
) -> T:
    started = time.monotonic()
    try:
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema,
            **({"system_instruction": system_instruction} if system_instruction else {}),
        )
        response = get_client().models.generate_content(model=model, contents=prompt, config=config)
    except GeminiUnavailableError as exc:
        log.warning("Gemini unavailable (model=%s%s): %s", model, f", {context}" if context else "", exc)
        raise
    except Exception as exc:  # noqa: BLE001 - any client/network failure means "unavailable"
        detail = describe_failure(exc)
        log.warning(
            "Gemini request failed after %.1fs (model=%s%s): %s",
            time.monotonic() - started, model, f", {context}" if context else "", detail,
        )
        if isinstance(exc, genai_errors.APIError) and exc.code in _TEMPORARY_STATUS_CODES:
            raise _TemporaryFailure(detail) from exc
        raise GeminiUnavailableError(f"Gemini request failed: {detail}") from exc

    parsed = getattr(response, "parsed", None)
    if not isinstance(parsed, schema):
        finish = None
        candidates = getattr(response, "candidates", None) or []
        if candidates:
            finish = getattr(candidates[0], "finish_reason", None)
        log.warning(
            "Gemini reply could not be parsed (model=%s%s, finish_reason=%s)",
            model, f", {context}" if context else "", finish,
        )
        raise GeminiUnavailableError(
            "Gemini's structured response could not be parsed"
            + (f" (finish reason: {finish})." if finish else ".")
        )
    return parsed


def _is_default_temporary(exc: genai_errors.APIError) -> bool:
    return exc.code in _TEMPORARY_STATUS_CODES


def generate_text_with_fallback(
    prompt: str, models: Sequence[str], *, use_url_context: bool = False,
    is_temporary: Callable[[genai_errors.APIError], bool] | None = None, context: str = "",
) -> tuple[str | None, str]:
    """Plain-text generation (no response schema) for agents whose prompts ask
    for free text or hand-written JSON. Returns (response.text, model that
    answered); the text may be empty or None, which callers check.

    `models` are tried in order. The next one is tried only after a temporary
    error: HTTP 429/503 by default (as in generate_structured_with_model), or
    whatever `is_temporary` accepts. Any other failure raises at once.
    `use_url_context` enables Gemini's URL context tool, so the prompt may ask
    Gemini to read a web page. Failures raise GeminiUnavailableError with a
    sanitized message and are logged without the prompt or reply."""
    if not models:
        raise ValueError("At least one Gemini model is required.")
    temporary = is_temporary or _is_default_temporary
    label = f", {context}" if context else ""
    failures: list[str] = []
    for index, model in enumerate(models):
        started = time.monotonic()
        try:
            config = (
                types.GenerateContentConfig(tools=[types.Tool(url_context=types.UrlContext())])
                if use_url_context else None
            )
            response = get_client().models.generate_content(model=model, contents=prompt, config=config)
        except GeminiUnavailableError as exc:
            log.warning("Gemini unavailable (model=%s%s): %s", model, label, exc)
            raise
        except Exception as exc:  # noqa: BLE001 - any client/network failure means "unavailable"
            detail = describe_failure(exc)
            log.warning("Gemini request failed after %.1fs (model=%s%s): %s",
                        time.monotonic() - started, model, label, detail)
            if not (isinstance(exc, genai_errors.APIError) and temporary(exc)):
                raise GeminiUnavailableError(f"Gemini request failed: {detail}") from exc
            failures.append(f"{model}: {detail}")
            if index == len(models) - 1:
                message = (f"Gemini request failed: {detail}" if len(models) == 1 else
                           "Gemini request failed on every configured model: " + "; ".join(failures))
                raise GeminiUnavailableError(message) from exc
            log.info("Trying the next Gemini model after a temporary error (model=%s%s)", model, label)
            continue
        return getattr(response, "text", None), model
    raise AssertionError("unreachable")  # pragma: no cover

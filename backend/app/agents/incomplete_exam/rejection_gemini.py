"""Gemini wording step for Agent 6. Gemini receives only the facts Python verified plus
Agent 5's own explanations; it may pick judgment keywords from a closed list and must
write suggested reasons grounded only in what it was given.

Unchanged from the standalone services/rejection_gemini.py: _RULES, the reply
schema, the system instruction, temperature 0.3, the result shape and statuses
("ok", "unavailable" without a key, "error" on any failure), and three
attempts on the same model after a temporary error (waits of 1 s and 2 s).
Changes: the call goes through app.core.gemini (shared client, sanitized
errors), the configured fallback models are tried after the retries, and
the answering model is recorded.
"""

import json
from typing import Literal

from pydantic import BaseModel

from app.config import get_settings
from app.core.gemini import GeminiUnavailableError, describe_failure, generate_structured_with_model

from . import llm_calls


class _SuggestedReason(BaseModel):
    tone: Literal["formal", "concise", "supportive"]
    text: str
    addresses_keywords: list[str]


class _RejectionSuggestions(BaseModel):
    judgment_keywords: list[str]
    suggested_reasons: list[_SuggestedReason]
    conflict_note: str  # empty string means none


_RULES = """You write suggested rejection reasons for an Incomplete Exam request that the
eligibility agent has already recommended rejecting. You do NOT decide anything.

Rules:
1. Use ONLY the information in the provided context. Never invent facts, dates, numbers,
   policies, or document details.
2. judgment_keywords: choose zero or more ids ONLY from judgment_keyword_options, and only
   when Agent 5's explanations clearly support them. Never create new ids.
3. Write exactly 3 suggested_reasons, one each with tone formal, concise, supportive.
   Each must address at least one keyword id (deterministic_keywords or the judgment ones
   you chose) in addresses_keywords, and must cover every deterministic keyword.
4. Address the student in the second person.
5. Do not accuse the student of dishonesty or fabrication. For a proof problem say the
   document could not be accepted or does not support the stated reason.
6. Do not mention AI, Gemini or an automated agent. Do not promise appeals, retakes or any
   procedure not present in the context.
7. If Agent 5's explanations contradict the verified facts, state it briefly in
   conflict_note; otherwise return an empty string.
"""

TEMPERATURE = 0.3
RETRY_DELAYS = (1, 2)   # standalone _generate_with_retry: 3 attempts, sleeping i + 1


def get_rejection_suggestions(context: dict) -> dict:
    out = {"status": "ok", "error": None, "judgment_keywords": [],
           "suggested_reasons": [], "conflict_note": ""}
    settings = get_settings()
    if not settings.gemini_api_key:
        out.update(status="unavailable", error="GEMINI_API_KEY is not set.")
        return out
    try:
        parsed, model = generate_structured_with_model(
            json.dumps(context, indent=2, default=str),
            _RejectionSuggestions,
            model=settings.gemini_model,
            fallback_models=settings.gemini_fallback_models,
            system_instruction=_RULES,
            temperature=TEMPERATURE,
            retry_delays=RETRY_DELAYS,
            context=f"incomplete exam rejection {context.get('request_id')}",
        )
        llm_calls.record("rejection", model)
        out["judgment_keywords"] = list(parsed.judgment_keywords)
        out["suggested_reasons"] = [r.model_dump() for r in parsed.suggested_reasons]
        out["conflict_note"] = parsed.conflict_note or ""
    except GeminiUnavailableError as exc:
        out.update(status="error", error=str(exc))   # already sanitized
    except Exception as exc:  # noqa: BLE001 - as in the standalone: any failure -> template fallback
        out.update(status="error", error=describe_failure(exc))
    return out

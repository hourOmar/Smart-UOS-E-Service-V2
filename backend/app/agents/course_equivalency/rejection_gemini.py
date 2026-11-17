"""Gemini wording step for the rejection explanation agent. Gemini receives only the facts
Python verified plus the eligibility agent's own explanations; it may pick judgment keywords
from a closed list and must write reasons grounded only in what it was given.

Unchanged from the standalone services/rejection_gemini.py: _RULES, the reply schema, the
system instruction, temperature 0.3, the result shape and statuses ("ok", "unavailable"
without a key, "error" on any failure -- the agent then uses its template reasons).
Changes: the call goes through app.core.gemini (shared client, sanitized errors, configured
fallback models) and the answering model is recorded.
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


_RULES = """You write suggested rejection reasons for a Course Equivalency request that the
eligibility agent has already recommended rejecting. You do NOT decide anything.

Rules:
0. Never choose insufficient_syllabus_detail when a syllabus is missing or was not uploaded; that is a
   separate request to the professor, not a weakness of the syllabus. Only mention a pending program
   change if the evidence marks it as pending for this course.
1. Use ONLY the information in the provided context. Never invent facts, topics, numbers,
   grades, credit hours or policies.
2. judgment_keywords: choose zero or more ids ONLY from judgment_keyword_options, and only when
   the eligibility agent's explanations clearly support them. Never create new ids.
3. Write exactly 3 suggested_reasons, one each with tone formal, concise, supportive. Each must
   list at least one keyword id (deterministic_keywords or the judgment ones you chose) in
   addresses_keywords, and together they must cover every deterministic keyword.
4. Base the wording on the similarity percentage: say how close or far the courses are, and name
   the missing topics or credit hour difference when the context provides them.
5. Address the student in the second person. Be respectful.
6. Do not mention AI, Gemini or an automated agent. Do not promise appeals, re-evaluation or any
   procedure not present in the context.
7. If the eligibility agent's explanations contradict the verified facts, state it briefly in
   conflict_note; otherwise return an empty string.
"""

TEMPERATURE = 0.3


def get_rejection_suggestions(context: dict) -> dict:
    out = {"status": "ok", "error": None, "judgment_keywords": [], "suggested_reasons": [], "conflict_note": ""}
    settings = get_settings()
    if not settings.gemini_api_key:
        out.update(status="unavailable", error="GEMINI_API_KEY is not set.")
        return out
    try:
        parsed, model = generate_structured_with_model(
            json.dumps(context, indent=2, default=str), _RejectionSuggestions, model=settings.gemini_model,
            fallback_models=settings.gemini_fallback_models, system_instruction=_RULES, temperature=TEMPERATURE,
            context=f"course equivalency rejection {context.get('request_id')}",
        )
        llm_calls.record("rejection", model)
        out.update(judgment_keywords=list(parsed.judgment_keywords),
                   suggested_reasons=[r.model_dump() for r in parsed.suggested_reasons],
                   conflict_note=parsed.conflict_note or "")
    except GeminiUnavailableError as exc:
        out.update(status="error", error=str(exc))   # already sanitized
    except Exception as exc:  # noqa: BLE001 - as in the standalone: any failure -> template fallback
        out.update(status="error", error=describe_failure(exc))
    return out

"""
Calls Gemini for one prioritization decision with structured output, so the
result is validated against PriorityDecision rather than parsed from free text.

Ported onto app.core.gemini: the same system instruction and prompt
(gemini_prompt.build_gemini_prompt), the same response schema, and the same
fallback strategy — the configured fallback models (GEMINI_FALLBACK_MODELS) are
tried in order only after a temporary 429/503 error; any other failure stops at
once. Every technical failure (configuration, API/network error, empty or
schema-invalid reply) raises GeminiUnavailableError; it never becomes a
priority, and in particular never MANUAL_REVIEW.
"""

from app.core.gemini import fallback_model_names, generate_structured_with_model

from ..pipeline.gemini_prompt import build_gemini_prompt
from ..schemas.prioritization_evidence import PrioritizationEvidencePackage
from ..schemas.priority_decision import PriorityDecision


def get_priority_decision(
    evidence: PrioritizationEvidencePackage, policy: dict, context: str = ""
) -> tuple[PriorityDecision, str]:
    """Returns the validated decision and the model that produced it."""
    system_instruction, user_content = build_gemini_prompt(evidence, policy)
    return generate_structured_with_model(
        user_content,
        PriorityDecision,
        system_instruction=system_instruction,
        fallback_models=fallback_model_names(),
        context=context,
    )

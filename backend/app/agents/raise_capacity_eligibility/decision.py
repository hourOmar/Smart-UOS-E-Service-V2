"""Gemini is the decision-making layer (unchanged architecture).

Python collects and computes verified evidence; Gemini applies the explicit decision
rules below and returns APPROVE / REJECT / MANUAL_REVIEW with explanations. It may
not invent facts, recompute capacity, query the database or browse. If Gemini is
unavailable there is no deterministic fallback recommendation: the result is
MANUAL_REVIEW with the collected evidence.

The student's identity (ID and name) is removed from what Gemini receives; it is not
needed to apply the rules.
"""

import json

from app.core.gemini import GeminiUnavailableError, generate_structured, model_name

from .schemas import EligibilityDecision


def gemini_evidence(evidence_package: dict) -> dict:
    """The evidence Gemini sees: everything except the student's identity."""
    return {key: value for key, value in evidence_package.items() if key != "student"}


def build_prompt(evidence_package: dict) -> str:
    evidence_json = json.dumps(gemini_evidence(evidence_package), indent=2, default=str)
    return f"""You are the Academic Eligibility Evaluation Agent for University of Sharjah
Raise Capacity requests. You decide the final recommendation -- APPROVE, REJECT, or
MANUAL_REVIEW -- by applying the decision rules below to the verified evidence provided.

All evidence below was ALREADY collected and computed deterministically in Python from
verified sources: the official University of Sharjah website (prerequisite), the student's
transcript and the approved grade policy (prerequisite satisfaction), the local
completed-hours knowledge base, and the Section table (capacity). Do NOT recompute,
re-derive, or second-guess any of these values -- especially the capacity numbers, which
are already final. Do NOT invent any prerequisite, grade, threshold, or capacity number
that is not present in the evidence below. Do NOT query any database or browse the web --
everything you need is in the evidence below.

DECISION RULES (apply exactly; use no other rule):

APPROVE requires ALL of:
- checks.prerequisite.verified is true AND checks.prerequisite.satisfied is true
- the completed-hours requirement is satisfied WHENEVER it applies -- if
  checks.completed_hours.applicable is false, this condition is automatically met (no rule
  is configured for this course, which is not a failure)
- checks.capacity.satisfied is true (additional section capacity is available)

REJECT applies when ANY of:
- checks.prerequisite.verified is true AND checks.prerequisite.satisfied is false (a
  CONFIRMED, verified failure -- not merely unresolved)
- checks.completed_hours.applicable is true AND checks.completed_hours.satisfied is false
- checks.capacity.satisfied is false (no additional capacity remains)

MANUAL_REVIEW applies whenever neither APPROVE nor REJECT can be conclusively determined,
for example:
- checks.prerequisite.verified is false (could not be verified from the UoS source)
- checks.prerequisite.satisfied is null (unresolved -- e.g. a grade value outside the
  approved policy, or a text-only condition with no course ID)
- checks.completed_hours.applicable is true AND checks.completed_hours.satisfied is null
  (the student's completed hours are not recorded, so the rule cannot be verified)
- any other required input is missing or ambiguous

CRITICAL RULE: missing or unverifiable evidence is NEVER the same as a failed requirement.
It must lead to MANUAL_REVIEW, never REJECT. REJECT requires a CONFIRMED, verified failure.

Verified evidence:
{evidence_json}

Produce the structured response:
- recommendation: APPROVE, REJECT, or MANUAL_REVIEW, decided strictly by the rules above.
- reasoning: 3-5 sentences explaining the overall decision and which rule(s) it followed.
- checks.prerequisite: explain the prerequisite outcome, citing the specific evidence
  (course IDs, verification/satisfaction status, grades where relevant) that produced it.
  If additional_text_conditions is non-empty, mention it separately as a condition that
  exists but was not itself evaluated. If the prerequisite could not be verified because
  the course is not on the source page, say that only Computer Science degree-page
  courses can be verified (see checks.prerequisite.source_scope).
- checks.completed_hours: if applicable is false, clearly state that no completed-hours
  rule is configured for this course (not a failure). If applicable, cite the student's
  completed hours against the required hours, or state that they are not recorded.
- checks.capacity: cite the actual current/total/additional/maximum/remaining capacity
  numbers and state whether additional space remains."""


def get_decision(evidence_package: dict) -> dict:
    model = model_name()
    try:
        parsed = generate_structured(
            build_prompt(evidence_package), EligibilityDecision, model=model,
            context=f"request {evidence_package.get('request_id')}",
        )
    except GeminiUnavailableError as exc:
        return unavailable_result(evidence_package, str(exc), model)
    return {
        "status": "ok",
        "model": model,
        "recommendation": parsed.recommendation,
        "reasoning": parsed.reasoning,
        "checks": parsed.checks.model_dump(),
        "error": None,
    }


def unavailable_result(evidence_package: dict, error: str, model: str) -> dict:
    """No deterministic fallback recommendation: MANUAL_REVIEW with the evidence."""
    checks = evidence_package.get("checks", {})
    return {
        "status": "unavailable",
        "model": model,
        "recommendation": "MANUAL_REVIEW",
        "reasoning": (
            "Gemini (the decision-making layer) was unavailable, so no automated recommendation "
            f"could be produced: {error}. Verified evidence was collected and is available for "
            "manual review."
        ),
        "checks": {
            "prerequisite": f"Not reviewed by Gemini. Evidence collected: {checks.get('prerequisite')}",
            "completed_hours": f"Not reviewed by Gemini. Evidence collected: {checks.get('completed_hours')}",
            "capacity": f"Not reviewed by Gemini. Evidence collected: {checks.get('capacity')}",
        },
        "error": error,
    }

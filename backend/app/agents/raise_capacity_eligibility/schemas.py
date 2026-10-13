"""Gemini's structured reply (unchanged from the prototype)."""

from typing import Literal

from pydantic import BaseModel

Recommendation = Literal["APPROVE", "REJECT", "MANUAL_REVIEW"]


class CheckExplanations(BaseModel):
    prerequisite: str
    completed_hours: str
    capacity: str


class EligibilityDecision(BaseModel):
    recommendation: Recommendation
    reasoning: str
    checks: CheckExplanations

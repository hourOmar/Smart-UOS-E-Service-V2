"""
Pydantic models for Gemini's structured prioritization decision (Phase 6)
and the final agent result. Gemini's raw JSON response is validated
against PriorityDecision — an invalid priority value, missing reasoning,
empty reasoning, or a missing/empty factor explanation all fail Pydantic
validation rather than being silently accepted or guessed at.
"""

from typing import Literal

from pydantic import BaseModel, Field

Priority = Literal["HIGH", "MEDIUM", "LOW", "MANUAL_REVIEW"]


class FactorExplanations(BaseModel):
    graduation: str = Field(min_length=1)
    degree_progress: str = Field(min_length=1)
    course_requirement: str = Field(min_length=1)
    course_availability: str = Field(min_length=1)
    previous_attempts: str = Field(min_length=1)
    prerequisite: str = Field(min_length=1)
    progression: str = Field(min_length=1)


class PriorityDecision(BaseModel):
    priority: Priority
    reasoning: str = Field(min_length=1)
    factor_explanations: FactorExplanations
    key_evidence: list[str] = Field(default_factory=list)


class FinalAgentResult(BaseModel):
    request_id: str
    priority: Priority
    reasoning: str
    factor_explanations: FactorExplanations
    key_evidence: list[str] = Field(default_factory=list)

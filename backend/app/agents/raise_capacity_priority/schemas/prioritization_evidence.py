"""
Pydantic models for the Phase 5 final prioritization evidence package —
the single structured object Phase 6 will hand to Gemini alongside the
(separately-loaded) prioritization policy. See app/pipeline/
build_prioritization_evidence.py for why the policy is NOT embedded
here.

Most sections reuse Phase 3/4 evidence models directly rather than
redefining their fields, so this file only defines what is genuinely
new: request context, graduation comparison, and the evidence-quality
summary. No field here is a priority judgment.
"""

from typing import Optional

from pydantic import BaseModel

from ..schemas.deterministic import (
    PreviousAttemptSummaryEvidence,
    PrerequisiteCompletionEvidence,
    ProgressionEvidence,
    RemainingCreditsEvidence,
    RequestedCourseOfferingEvidence,
)
from ..schemas.uos import CourseCategoryEvidence


class RequestContext(BaseModel):
    request_id: str
    student_id: str
    request_term: int
    course_id: int
    course_name: str
    section_id: str
    reason: Optional[str]


class GraduationEvidence(BaseModel):
    request_term: int
    expected_graduation_term: Optional[int]
    same_as_expected_graduation_term: Optional[bool]
    # Term transitions strictly after request_term, up to and including
    # expected_graduation_term. None when expected_graduation_term is
    # missing, either term's semester suffix is unsupported, or
    # expected_graduation_term precedes request_term.
    terms_until_graduation_including_summer: Optional[int]
    terms_until_graduation_excluding_summer: Optional[int]


class EvidenceQualitySummary(BaseModel):
    has_missing_evidence: bool
    has_conflicting_evidence: bool
    issues: list[str]


class PrioritizationEvidencePackage(BaseModel):
    request_context: RequestContext
    graduation: GraduationEvidence
    degree_progress: RemainingCreditsEvidence
    requested_course_requirement: CourseCategoryEvidence
    course_availability: RequestedCourseOfferingEvidence
    previous_attempts: PreviousAttemptSummaryEvidence
    prerequisite_completion: PrerequisiteCompletionEvidence
    progression: ProgressionEvidence
    evidence_quality: EvidenceQualitySummary

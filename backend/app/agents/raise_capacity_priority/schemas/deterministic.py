"""
Pydantic models for Phase 4 deterministic evaluation results. Every
field here is a FACT Python computed or a FACT it could not compute
(explicitly represented as missing/unresolved) — never a priority
judgment. No field named priority/HIGH/MEDIUM/LOW exists anywhere in
this module, deliberately.
"""

from typing import Literal, Optional

from pydantic import BaseModel

from ..deterministic.grade_policy import GradeStatus
from ..deterministic.term import Semester
from ..schemas.uos import CourseCategory, PrerequisiteNode, SourceSection


class RemainingCreditsEvidence(BaseModel):
    completed_hours: Optional[int]
    total_required_credits: Optional[int]
    remaining_credits: Optional[int]
    status: Literal["OK", "UNRESOLVED", "ANOMALY"]
    note: Optional[str]


class TakesRecordEvaluation(BaseModel):
    course_id: int
    grade: Optional[str]
    term: int
    grade_status: GradeStatus


class PrerequisiteLeafEvaluation(BaseModel):
    kind: Literal["COURSE", "STANDING"]
    course_id: Optional[int]
    standing_text: Optional[str]
    status: Literal["SATISFIED", "NOT_SATISFIED", "UNRESOLVED"]
    reason: str
    matched_takes_records: list[TakesRecordEvaluation]


class PrerequisiteCompletionEvidence(BaseModel):
    course_id: int
    status: Literal["SATISFIED", "NOT_SATISFIED", "UNRESOLVED", "CONFLICT"]
    reason: str
    source_section_used: Optional[SourceSection]
    relation: Optional[Literal["PREREQUISITE", "PRE_OR_CO"]]
    requirement_expression: Optional[PrerequisiteNode]
    leaf_evaluations: list[PrerequisiteLeafEvaluation]
    uos_conflict: bool
    uos_conflict_reason: Optional[str]


class RequestedCourseOfferingEvidence(BaseModel):
    course_id: int
    found_in_kb: bool
    fall: Optional[bool]
    spring: Optional[bool]
    summer: Optional[bool]
    offered_semester_count: Optional[int]
    offered_semesters: list[Semester]
    summer_available: Optional[bool]
    current_semester: Optional[Semester]
    next_semester: Optional[Semester]
    offered_next_semester: Optional[bool]
    term_suffix_supported: bool
    source: str


class PreviousAttemptSummaryEvidence(BaseModel):
    attempted_before: bool
    number_of_attempts: int
    previous_grades: list[Optional[str]]
    previous_terms: list[int]
    excluded_current_context_records: int


class DependentCourseOffering(BaseModel):
    course_id: int
    course_name: str
    category: Optional[CourseCategory]
    specific_course_mandatory: Optional[bool]
    always_required: bool
    study_plan_year: Optional[int]
    study_plan_semester: Optional[int]
    found_in_offerings_kb: bool
    fall: Optional[bool]
    spring: Optional[bool]
    summer: Optional[bool]


class ProgressionEvidence(BaseModel):
    requested_course_id: int
    total_dependent_courses: int
    mandatory_or_core_dependent_count: int
    elective_dependent_count: int
    always_required_dependent_count: int
    or_alternative_dependent_count: int
    dependent_courses_missing_from_offerings_kb: int
    dependent_courses: list[DependentCourseOffering]


class DeterministicEvidence(BaseModel):
    remaining_credits: RemainingCreditsEvidence
    prerequisite_completion: PrerequisiteCompletionEvidence
    requested_course_offering: RequestedCourseOfferingEvidence
    previous_attempt_summary: PreviousAttemptSummaryEvidence
    progression_evidence: ProgressionEvidence

"""
Pydantic models for official UoS Computer Science degree-page evidence
(Phase 3). All models here describe FACTS retrieved from the page —
category membership, prerequisite structure, study-plan placement, and
subsequent-course dependency. None of them make a prioritization
judgment; that belongs to a later phase.

The prerequisite models are recursive because raw prerequisite text on
the page mixes AND, OR, nested groups, standing requirements, and
Pre/Co status (e.g. "1501341, (1501246 or 1501247)", "1501215 and
Junior Standing", "Pre/Co: 1430110"). Flattening these to a plain list
would lose exactly the meaning the agent needs later.
"""

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field

SourceSection = Literal["DEGREE_REQUIREMENTS", "STUDY_PLAN", "COURSE_DESCRIPTION"]
CourseCategory = Literal["MANDATORY", "MANDATORY_CORE", "ELECTIVE"]


class PrerequisiteCourseRef(BaseModel):
    kind: Literal["COURSE"] = "COURSE"
    course_id: int
    raw_text: str


class PrerequisiteStanding(BaseModel):
    kind: Literal["STANDING"] = "STANDING"
    text: str


class PrerequisiteGroup(BaseModel):
    kind: Literal["GROUP"] = "GROUP"
    operator: Literal["AND", "OR"]
    items: list["PrerequisiteNode"]


PrerequisiteNode = Annotated[
    Union[PrerequisiteCourseRef, PrerequisiteStanding, PrerequisiteGroup],
    Field(discriminator="kind"),
]
PrerequisiteGroup.model_rebuild()


class ParsedPrerequisite(BaseModel):
    """One section's raw prerequisite text, parsed."""

    source_section: SourceSection
    raw_text: str
    relation: Literal["PREREQUISITE", "PRE_OR_CO"]
    expression: Optional[PrerequisiteNode]
    parseable: bool


class PrerequisiteEvidence(BaseModel):
    """Merged prerequisite evidence for one course across every section
    of the page it was found in."""

    course_id: int
    course_found: bool
    by_source: list[ParsedPrerequisite]
    consistent: bool
    conflict: bool
    conflict_reason: Optional[str]
    source_url: str


class CourseCategoryEvidence(BaseModel):
    course_id: int
    course_name: Optional[str]
    found: bool
    category: Optional[CourseCategory]
    specific_course_mandatory: Optional[bool]
    credit_hours: Optional[int]
    source_url: str


class TotalDegreeCreditsEvidence(BaseModel):
    total_required_credits: Optional[int]
    verified: bool
    retrieval_status: Literal["OK", "NOT_FOUND", "CONFLICTING"]
    raw_values_found: list[int]
    source_url: str


class StudyPlanEntry(BaseModel):
    course_id: Optional[int]
    course_name: str
    credit_hours: Optional[int]
    year: int
    semester: int
    prerequisite_raw_text: Optional[str]
    is_placeholder_elective: bool


class DependentCourse(BaseModel):
    course_id: int
    course_name: str
    category: Optional[CourseCategory]
    specific_course_mandatory: Optional[bool]
    always_required: bool
    study_plan_year: Optional[int]
    study_plan_semester: Optional[int]


class SubsequentCourseImpactEvidence(BaseModel):
    requested_course_id: int
    dependent_courses: list[DependentCourse]
    dependent_mandatory_or_core_count: int
    dependent_elective_count: int
    source_url: str


class UoSCourseEvidence(BaseModel):
    """Bundled UoS evidence for one requested course — the Phase 3
    equivalent of Phase 2's SupabaseEvidence."""

    course_id: int
    source_url: str
    total_degree_credits: TotalDegreeCreditsEvidence
    category: CourseCategoryEvidence
    prerequisites: PrerequisiteEvidence
    subsequent_course_impact: SubsequentCourseImpactEvidence
    study_plan_entry: Optional[StudyPlanEntry]

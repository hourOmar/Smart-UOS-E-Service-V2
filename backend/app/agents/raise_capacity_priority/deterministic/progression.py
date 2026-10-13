"""
Enriches Phase 3's UoS dependent-course list with Fall/Spring/Summer
offering facts from the local KB, and computes factual summary counts.
Never produces a progression-impact score or judgment — only counts and
per-course facts for Gemini to reason about later.
"""

from ..deterministic.course_offerings import get_course_offering
from ..schemas.deterministic import DependentCourseOffering, ProgressionEvidence
from ..schemas.uos import SubsequentCourseImpactEvidence


def build_progression_evidence(
    subsequent_impact: SubsequentCourseImpactEvidence,
) -> ProgressionEvidence:
    dependent_courses: list[DependentCourseOffering] = []
    missing_from_kb_count = 0
    always_required_count = 0
    or_alternative_count = 0

    for dependent in subsequent_impact.dependent_courses:
        offered = get_course_offering(dependent.course_id)
        found = offered is not None
        if not found:
            missing_from_kb_count += 1
        if dependent.always_required:
            always_required_count += 1
        else:
            or_alternative_count += 1

        dependent_courses.append(
            DependentCourseOffering(
                course_id=dependent.course_id,
                course_name=dependent.course_name,
                category=dependent.category,
                specific_course_mandatory=dependent.specific_course_mandatory,
                always_required=dependent.always_required,
                study_plan_year=dependent.study_plan_year,
                study_plan_semester=dependent.study_plan_semester,
                found_in_offerings_kb=found,
                fall=offered["fall"] if found else None,
                spring=offered["spring"] if found else None,
                summer=offered["summer"] if found else None,
            )
        )

    return ProgressionEvidence(
        requested_course_id=subsequent_impact.requested_course_id,
        total_dependent_courses=len(dependent_courses),
        mandatory_or_core_dependent_count=subsequent_impact.dependent_mandatory_or_core_count,
        elective_dependent_count=subsequent_impact.dependent_elective_count,
        always_required_dependent_count=always_required_count,
        or_alternative_dependent_count=or_alternative_count,
        dependent_courses_missing_from_offerings_kb=missing_from_kb_count,
        dependent_courses=dependent_courses,
    )

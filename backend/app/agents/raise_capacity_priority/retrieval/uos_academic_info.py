"""
Public UoS retrieval functions for Phase 3. Each function fetches the
official CS degree page (or accepts pre-fetched HTML, for tests and for
avoiding a repeat network call across several questions about one page
load) and returns one typed evidence object. None of these functions
make a prioritization judgment — they only establish facts.
"""

from typing import Optional

from bs4 import BeautifulSoup

from ..integrations.uos_client import CS_DEGREE_PAGE_URL
from ..integrations.uos_client import cached_cs_degree_page as fetch_cs_degree_page  # ported: cached
from ..retrieval.uos_html_parser import (
    DegreeRequirementRow,
    StudyPlanRow,
    parse_course_description_rows,
    parse_degree_requirements_and_study_plan,
    parse_total_credits_candidates,
)
from ..retrieval.uos_prerequisite_parser import (
    collect_course_ids,
    collect_standing_texts,
    find_course_reference_occurrences,
    parse_prerequisite_text,
    top_level_operator,
)
from ..schemas.uos import (
    CourseCategoryEvidence,
    DependentCourse,
    ParsedPrerequisite,
    PrerequisiteEvidence,
    StudyPlanEntry,
    SubsequentCourseImpactEvidence,
    TotalDegreeCreditsEvidence,
    UoSCourseEvidence,
)

_MANDATORY_CATEGORIES = ("MANDATORY", "MANDATORY_CORE")


def get_total_degree_credits(html: Optional[str] = None) -> TotalDegreeCreditsEvidence:
    soup = _soup(_html(html))
    return _build_total_credits_evidence(parse_total_credits_candidates(soup))


def get_course_category(course_id: int, html: Optional[str] = None) -> CourseCategoryEvidence:
    soup = _soup(_html(html))
    degree_rows, _study_plan_rows = parse_degree_requirements_and_study_plan(soup)
    return _build_category_evidence(course_id, degree_rows)


def get_course_prerequisites(course_id: int, html: Optional[str] = None) -> PrerequisiteEvidence:
    soup = _soup(_html(html))
    degree_rows, study_plan_rows = parse_degree_requirements_and_study_plan(soup)
    description_rows = parse_course_description_rows(soup)
    return _build_prerequisite_evidence(course_id, degree_rows, study_plan_rows, description_rows)


def get_subsequent_course_impact(
    course_id: int, html: Optional[str] = None
) -> SubsequentCourseImpactEvidence:
    soup = _soup(_html(html))
    degree_rows, study_plan_rows = parse_degree_requirements_and_study_plan(soup)
    return _build_subsequent_course_impact(course_id, degree_rows, study_plan_rows)


def get_uos_course_evidence(course_id: int, html: Optional[str] = None) -> UoSCourseEvidence:
    soup = _soup(_html(html))

    total_credits = _build_total_credits_evidence(parse_total_credits_candidates(soup))
    degree_rows, study_plan_rows = parse_degree_requirements_and_study_plan(soup)
    description_rows = parse_course_description_rows(soup)

    category = _build_category_evidence(course_id, degree_rows)
    prerequisites = _build_prerequisite_evidence(
        course_id, degree_rows, study_plan_rows, description_rows
    )
    subsequent_impact = _build_subsequent_course_impact(course_id, degree_rows, study_plan_rows)
    study_plan_entry = _find_study_plan_entry(course_id, study_plan_rows)

    return UoSCourseEvidence(
        course_id=course_id,
        source_url=CS_DEGREE_PAGE_URL,
        total_degree_credits=total_credits,
        category=category,
        prerequisites=prerequisites,
        subsequent_course_impact=subsequent_impact,
        study_plan_entry=study_plan_entry,
    )


def _html(html: Optional[str]) -> str:
    return html if html is not None else fetch_cs_degree_page()


def _soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "html.parser")


def _build_total_credits_evidence(values: list[int]) -> TotalDegreeCreditsEvidence:
    if not values:
        return TotalDegreeCreditsEvidence(
            total_required_credits=None,
            verified=False,
            retrieval_status="NOT_FOUND",
            raw_values_found=[],
            source_url=CS_DEGREE_PAGE_URL,
        )

    unique_values = sorted(set(values))
    if len(unique_values) == 1:
        return TotalDegreeCreditsEvidence(
            total_required_credits=unique_values[0],
            verified=True,
            retrieval_status="OK",
            raw_values_found=values,
            source_url=CS_DEGREE_PAGE_URL,
        )

    return TotalDegreeCreditsEvidence(
        total_required_credits=None,
        verified=False,
        retrieval_status="CONFLICTING",
        raw_values_found=values,
        source_url=CS_DEGREE_PAGE_URL,
    )


def _build_category_evidence(
    course_id: int, degree_rows: list[DegreeRequirementRow]
) -> CourseCategoryEvidence:
    matches = [row for row in degree_rows if row.course_id == course_id]
    if not matches:
        return CourseCategoryEvidence(
            course_id=course_id,
            course_name=None,
            found=False,
            category=None,
            specific_course_mandatory=None,
            credit_hours=None,
            source_url=CS_DEGREE_PAGE_URL,
        )

    row = matches[0]
    return CourseCategoryEvidence(
        course_id=course_id,
        course_name=row.course_name,
        found=True,
        category=row.category,
        specific_course_mandatory=row.category in _MANDATORY_CATEGORIES,
        credit_hours=row.credit_hours,
        source_url=CS_DEGREE_PAGE_URL,
    )


def _build_prerequisite_evidence(
    course_id: int,
    degree_rows: list[DegreeRequirementRow],
    study_plan_rows: list[StudyPlanRow],
    description_rows,
) -> PrerequisiteEvidence:
    parsed: list[ParsedPrerequisite] = []

    for row in degree_rows:
        if row.course_id == course_id:
            parsed.append(parse_prerequisite_text(row.prerequisite_raw_text, "DEGREE_REQUIREMENTS"))

    for row in study_plan_rows:
        if row.course_id == course_id:
            parsed.append(parse_prerequisite_text(row.prerequisite_raw_text, "STUDY_PLAN"))

    for row in description_rows:
        if row.course_id == course_id:
            parsed.append(parse_prerequisite_text(row.prerequisite_raw_text, "COURSE_DESCRIPTION"))

    consistent, conflict, conflict_reason = _check_consistency(parsed)

    return PrerequisiteEvidence(
        course_id=course_id,
        course_found=len(parsed) > 0,
        by_source=parsed,
        consistent=consistent,
        conflict=conflict,
        conflict_reason=conflict_reason,
        source_url=CS_DEGREE_PAGE_URL,
    )


def _signature(parsed: ParsedPrerequisite):
    return (
        parsed.relation,
        top_level_operator(parsed.expression),
        frozenset(collect_course_ids(parsed.expression)),
        frozenset(collect_standing_texts(parsed.expression)),
    )


def _check_consistency(
    parsed: list[ParsedPrerequisite],
) -> tuple[bool, bool, Optional[str]]:
    parseable = [p for p in parsed if p.parseable]
    if len(parseable) < 2:
        return True, False, None

    signatures = {_signature(p) for p in parseable}
    if len(signatures) == 1:
        return True, False, None

    details = "; ".join(f"{p.source_section}: {p.raw_text!r}" for p in parseable)
    return False, True, f"Prerequisite text differs materially across sections: {details}"


def _build_subsequent_course_impact(
    course_id: int,
    degree_rows: list[DegreeRequirementRow],
    study_plan_rows: list[StudyPlanRow],
) -> SubsequentCourseImpactEvidence:
    study_plan_index: dict[int, StudyPlanRow] = {}
    for row in study_plan_rows:
        if row.course_id is not None and row.course_id not in study_plan_index:
            study_plan_index[row.course_id] = row

    dependents: list[DependentCourse] = []
    for row in degree_rows:
        if row.course_id == course_id:
            continue

        parsed = parse_prerequisite_text(row.prerequisite_raw_text, "DEGREE_REQUIREMENTS")
        occurrences = find_course_reference_occurrences(parsed.expression, course_id)
        if not occurrences:
            continue

        plan_row = study_plan_index.get(row.course_id)
        dependents.append(
            DependentCourse(
                course_id=row.course_id,
                course_name=row.course_name,
                category=row.category,
                specific_course_mandatory=row.category in _MANDATORY_CATEGORIES,
                always_required=any(occurrences),
                study_plan_year=plan_row.year if plan_row else None,
                study_plan_semester=plan_row.semester if plan_row else None,
            )
        )

    return SubsequentCourseImpactEvidence(
        requested_course_id=course_id,
        dependent_courses=dependents,
        dependent_mandatory_or_core_count=sum(
            1 for d in dependents if d.category in _MANDATORY_CATEGORIES
        ),
        dependent_elective_count=sum(1 for d in dependents if d.category == "ELECTIVE"),
        source_url=CS_DEGREE_PAGE_URL,
    )


def _find_study_plan_entry(
    course_id: int, study_plan_rows: list[StudyPlanRow]
) -> Optional[StudyPlanEntry]:
    for row in study_plan_rows:
        if row.course_id == course_id:
            return StudyPlanEntry(
                course_id=row.course_id,
                course_name=row.course_name,
                credit_hours=row.credit_hours,
                year=row.year,
                semester=row.semester,
                prerequisite_raw_text=row.prerequisite_raw_text,
                is_placeholder_elective=row.is_placeholder_elective,
            )
    return None

"""
Deterministic Fall/Spring/Summer offering facts, sourced ONLY from
app/knowledge/raise_capacity/course_offerings.json — never inferred from
the UoS study plan (Phase 3's UoS retrieval and this local KB serve
different purposes and are never silently merged; see Phase 4 report).

A Course_ID missing from the KB is represented as explicitly
missing/unresolved everywhere (found_in_kb=False, every offering field
None) — never defaulted to "not offered".
"""

import json
from pathlib import Path
from typing import Optional

from ..deterministic.term import Semester, next_semester, parse_term
from ..schemas.deterministic import RequestedCourseOfferingEvidence

_KB_PATH = (
    Path(__file__).resolve().parents[1]
    / "knowledge"
    / "raise_capacity"
    / "course_offerings.json"
)
_LIST_CATEGORY_KEYS = (
    "university_compulsory_courses",
    "college_compulsory_courses",
    "major_compulsory_courses",
    "support_compulsory_courses",
)


def _load_offerings_index() -> dict[int, dict]:
    with open(_KB_PATH, encoding="utf-8") as f:
        data = json.load(f)

    index: dict[int, dict] = {}
    for key in _LIST_CATEGORY_KEYS:
        for course in data.get(key, []):
            index[int(course["course_id"])] = course
    for course in data.get("major_elective_courses", {}).get("courses", []):
        index[int(course["course_id"])] = course
    return index


_OFFERINGS_INDEX = _load_offerings_index()


def get_course_offering(course_id: int) -> Optional[dict]:
    """Returns the raw {"fall":bool,"spring":bool,"summer":bool} dict for
    course_id, or None if the course is not in the local KB."""
    entry = _OFFERINGS_INDEX.get(course_id)
    return entry["offered"] if entry is not None else None


def build_requested_course_offering_evidence(
    course_id: int, request_term: Optional[int]
) -> RequestedCourseOfferingEvidence:
    offered = get_course_offering(course_id)
    found = offered is not None

    fall = offered["fall"] if found else None
    spring = offered["spring"] if found else None
    summer = offered["summer"] if found else None

    offered_semesters: list[Semester] = []
    offered_count: Optional[int] = None
    if found:
        if fall:
            offered_semesters.append(Semester.FALL)
        if spring:
            offered_semesters.append(Semester.SPRING)
        if summer:
            offered_semesters.append(Semester.SUMMER)
        offered_count = len(offered_semesters)

    summer_available = summer if found else None

    current_semester = parse_term(request_term) if request_term is not None else None
    term_suffix_supported = current_semester is not None
    next_sem = next_semester(current_semester) if current_semester is not None else None

    offered_next_semester: Optional[bool] = None
    if found and next_sem is not None:
        semester_value = {Semester.FALL: fall, Semester.SPRING: spring, Semester.SUMMER: summer}
        offered_next_semester = semester_value[next_sem]

    return RequestedCourseOfferingEvidence(
        course_id=course_id,
        found_in_kb=found,
        fall=fall,
        spring=spring,
        summer=summer,
        offered_semester_count=offered_count,
        offered_semesters=offered_semesters,
        summer_available=summer_available,
        current_semester=current_semester,
        next_semester=next_sem,
        offered_next_semester=offered_next_semester,
        term_suffix_supported=term_suffix_supported,
        source="app/knowledge/raise_capacity/course_offerings.json",
    )

"""
Supabase retrieval for prerequisite-completion evaluation: the student's
Takes records for the SET of courses referenced in the requested
course's official prerequisite requirement.

Not to be confused with app/retrieval/academic_history.py, which
retrieves the student's Takes history for the REQUESTED course itself
(Phase 2, "previous attempts"). This module retrieves history for
whatever OTHER courses the requested course's prerequisite tree
references (e.g. Programming II when the requested course is Data
Structures) — a different question needing a different query.
"""

from typing import Any

from ..retrieval._query import select_rows_in
from ..schemas.academic_history import TakesRecord

_COLUMNS = "Course_ID, Grade, Section_ID, Term"


def get_takes_for_courses(
    client: Any, student_id: str, course_ids: set[int]
) -> list[TakesRecord]:
    if not course_ids:
        return []

    rows = select_rows_in(
        client,
        "Takes",
        _COLUMNS,
        {"Student_ID": student_id},
        "Course_ID",
        sorted(course_ids),
    )

    return [
        TakesRecord(
            course_id=row["Course_ID"],
            grade=row["Grade"],
            section_id=row["Section_ID"],
            term=row["Term"],
        )
        for row in rows
    ]

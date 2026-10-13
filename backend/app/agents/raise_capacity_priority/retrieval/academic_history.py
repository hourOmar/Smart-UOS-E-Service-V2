"""
Supabase retrieval for the Takes table (Step 7 of the retrieval flow) —
the student's history against the requested course.

Each matching row is flagged with matches_current_request_context: True
when its Section_ID and Term are identical to the current request's own
Section_ID/Term, meaning it is very likely the student's current-term
registration for this very request rather than a genuinely completed
previous attempt. Flagged rows are excluded from attempted_before/
number_of_attempts but kept in records, per the instruction to preserve
raw matching records and flag ambiguity rather than guess.
"""

from typing import Any

from ..retrieval._query import select_rows
from ..schemas.academic_history import (
    PreviousAttemptRecord,
    PreviousAttemptsSummary,
)

_COLUMNS = "Course_ID, Grade, Section_ID, Term"


def get_previous_attempts(
    client: Any,
    student_id: str,
    course_id: int,
    current_section_id: str,
    current_term: int,
) -> PreviousAttemptsSummary:
    rows = select_rows(
        client,
        "Takes",
        _COLUMNS,
        {"Student_ID": student_id, "Course_ID": course_id},
    )

    records: list[PreviousAttemptRecord] = []
    for row in rows:
        matches_current = (
            row["Section_ID"] == current_section_id and row["Term"] == current_term
        )
        records.append(
            PreviousAttemptRecord(
                course_id=row["Course_ID"],
                grade=row["Grade"],
                section_id=row["Section_ID"],
                term=row["Term"],
                matches_current_request_context=matches_current,
            )
        )

    genuine_previous = [
        record for record in records if not record.matches_current_request_context
    ]

    return PreviousAttemptsSummary(
        attempted_before=len(genuine_previous) > 0,
        number_of_attempts=len(genuine_previous),
        records=records,
    )

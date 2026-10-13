"""
Supabase retrieval for the Section table (Step 6 of the retrieval flow).

This exists mainly to validate that the requested Section_ID/Course_ID/
Term combination on the Raise_Capacity record actually exists. Capacity
fields are returned for identification only — this agent does not use
capacity for prioritization.
"""

from typing import Any

from ..retrieval._query import select_rows
from ..retrieval.errors import SectionMismatchError
from ..schemas.section import SectionInfo

_COLUMNS = (
    "Section_ID, Course_ID, Term, Current_Capacity, Total_Capacity, "
    "Additional_Capacity"
)


def get_section(
    client: Any, section_id: str, expected_course_id: int, expected_term: int
) -> SectionInfo:
    rows = select_rows(
        client,
        "Section",
        _COLUMNS,
        {
            "Section_ID": section_id,
            "Course_ID": expected_course_id,
            "Term": expected_term,
        },
    )
    if not rows:
        raise SectionMismatchError(
            f"No Section found matching Section_ID={section_id!r}, "
            f"Course_ID={expected_course_id!r}, Term={expected_term!r}. "
            "Section_ID is reused across courses/terms, so all three "
            "fields must match together."
        )

    row = rows[0]
    return SectionInfo(
        section_id=row["Section_ID"],
        course_id=row["Course_ID"],
        term=row["Term"],
        current_capacity=row["Current_Capacity"],
        total_capacity=row["Total_Capacity"],
        additional_capacity=row["Additional_Capacity"],
    )

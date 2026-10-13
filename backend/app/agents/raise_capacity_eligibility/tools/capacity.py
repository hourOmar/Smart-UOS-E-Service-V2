from sqlalchemy import text
from sqlalchemy.engine import Connection

from ..exceptions import SectionCourseMismatchError, SectionNotFoundError


def get_section_capacity(conn: Connection, section_id: str, course_id: str, term: int) -> dict:
    """Section_ID alone is NOT a unique key -- the same section number is reused across
    courses and terms. The real key is (Section_ID, Course_ID, Term), exactly what
    Raise_Capacity stores."""
    row = conn.execute(
        text(
            'SELECT "Section_ID", "Course_ID", "Term", "Current_Capacity", '
            '"Total_Capacity", "Additional_Capacity" FROM public."Section" '
            'WHERE "Section_ID" = :sid AND "Course_ID" = :cid AND "Term" = :term'
        ),
        {"sid": section_id, "cid": course_id, "term": term},
    ).mappings().first()
    if row is not None:
        return dict(row)

    # No exact match: say "wrong course" when the section exists for another course.
    other = conn.execute(
        text('SELECT "Course_ID" FROM public."Section" WHERE "Section_ID" = :sid AND "Term" = :term'),
        {"sid": section_id, "term": term},
    ).mappings().first()

    if other is not None:
        raise SectionCourseMismatchError(
            f"Section_ID={section_id} in Term={term} belongs to Course_ID={other['Course_ID']}, "
            f"not the requested Course_ID={course_id}."
        )
    raise SectionNotFoundError(f"No Section found for Section_ID={section_id}, Course_ID={course_id}, Term={term}.")


def evaluate_capacity(capacity_data: dict) -> dict:
    """All values come directly from the Section row; nothing is estimated."""
    current_capacity = capacity_data["Current_Capacity"]
    total_capacity = capacity_data["Total_Capacity"]
    additional_capacity = capacity_data["Additional_Capacity"]

    maximum_allowed_capacity = total_capacity + additional_capacity
    remaining_raise_capacity = maximum_allowed_capacity - current_capacity
    extra_capacity_available = current_capacity < maximum_allowed_capacity

    return {
        "current_capacity": current_capacity,
        "total_capacity": total_capacity,
        "additional_capacity": additional_capacity,
        "maximum_allowed_capacity": maximum_allowed_capacity,
        "remaining_raise_capacity": remaining_raise_capacity,
        "satisfied": extra_capacity_available,
    }

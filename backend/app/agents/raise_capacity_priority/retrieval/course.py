"""
Supabase retrieval for the Course table (Step 5 of the retrieval flow).
"""

from typing import Any

from ..retrieval._query import select_rows
from ..retrieval.errors import CourseNotFoundError
from ..schemas.course import CourseInfo

_COLUMNS = "Course_ID, Course_Name, Credit_Hours"


def get_course(client: Any, course_id: int) -> CourseInfo:
    rows = select_rows(client, "Course", _COLUMNS, {"Course_ID": course_id})
    if not rows:
        raise CourseNotFoundError(f"No Course found for Course_ID={course_id!r}.")

    row = rows[0]
    return CourseInfo(
        course_id=row["Course_ID"],
        course_name=row["Course_Name"],
        credit_hours=row["Credit_Hours"],
    )

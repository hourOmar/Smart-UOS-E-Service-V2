"""
Supabase retrieval for the Student table (Step 3 of the retrieval flow).

Completed_Hours and Expected_Graduation_Term are returned exactly as
Supabase stores them — never calculated here.
"""

from typing import Any

from ..retrieval._query import select_rows
from ..retrieval.errors import StudentNotFoundError
from ..schemas.student import StudentAcademicProfile

_COLUMNS = (
    "Student_ID, Student_Name, CGPA, Completed_Hours, Program_ID, "
    "Expected_Graduation_Term"
)


def get_student(client: Any, student_id: str) -> StudentAcademicProfile:
    rows = select_rows(client, "Student", _COLUMNS, {"Student_ID": student_id})
    if not rows:
        raise StudentNotFoundError(
            f"No Student found for Student_ID={student_id!r}."
        )

    row = rows[0]
    return StudentAcademicProfile(
        student_id=row["Student_ID"],
        student_name=row["Student_Name"],
        cgpa=row["CGPA"],
        completed_hours=row["Completed_Hours"],
        program_id=row["Program_ID"],
        expected_graduation_term=row["Expected_Graduation_Term"],
    )

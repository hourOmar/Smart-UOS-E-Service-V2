from sqlalchemy import text
from sqlalchemy.engine import Connection

from ..exceptions import StudentNotFoundError


def get_student_academic_info(conn: Connection, student_id: str) -> dict:
    row = conn.execute(
        text(
            'SELECT "Student_ID", "Student_Name", "CGPA", "Completed_Hours", "Program_ID" '
            'FROM public."Student" WHERE "Student_ID" = :sid'
        ),
        {"sid": student_id},
    ).mappings().first()
    if row is None:
        raise StudentNotFoundError(f"No Student found for Student_ID={student_id}.")
    return dict(row)


def get_student_transcript(conn: Connection, student_id: str) -> list[dict]:
    rows = conn.execute(
        text(
            'SELECT t."Course_ID", c."Course_Name", t."Grade", t."Term", t."Section_ID" '
            'FROM public."Takes" t JOIN public."Course" c ON c."Course_ID" = t."Course_ID" '
            'WHERE t."Student_ID" = :sid ORDER BY t."Term", t."Course_ID"'
        ),
        {"sid": student_id},
    ).mappings().all()
    return [dict(row) for row in rows]

from sqlalchemy import text
from sqlalchemy.engine import Connection


def fetch_course(conn: Connection, course_id: str) -> dict | None:
    row = conn.execute(
        text('SELECT "Course_ID", "Course_Name", "Credit_Hours" FROM public."Course" WHERE "Course_ID" = :cid'),
        {"cid": str(course_id)},
    ).mappings().first()
    return dict(row) if row is not None else None

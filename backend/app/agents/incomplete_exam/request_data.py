"""Incomplete Exam request data, read directly by the backend.

Replaces the standalone services/database.py, tools/request_tools.py,
tools/student_tools.py and tools/enrollment_tools.py. The same queries, with
quoted identifiers and bound parameters, run as the backend's own role
(app.core.database.read_only) in ONE read-only transaction that is closed
before any Storage or Gemini call. The results have the standalone shapes:

    request     {**Request row, **Incomplete_Exam row}  (as get_incomplete_exam_request)
    student     {Student_ID, Student_Name}              (only what the evidence uses)
    enrollment  Takes row {Student_ID, Course_ID, Section_ID, Term, Grade} or None

Database access this needs (Phase 2, not installed yet): SELECT on
Incomplete_Exam (Request_ID, Reason, Proof, Missed_Exam_Date, Missed_Exam_Time,
Course_ID, Section_ID, Term, Exam_Type, Proof_Files) plus a backend read
policy. Request, Student and Takes are already granted by eligibility/01_install.sql.
"""

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.database import read_only

from .exceptions import (
    IncompleteExamDetailsMissingError, NotIncompleteExamRequestError, RequestNotFoundError, StudentNotFoundError,
)

INCOMPLETE_EXAM = "Incomplete Exam"

REQUEST_SQL = text(
    'SELECT "Request_ID", "Student_ID", "Request_Type", "Request_Date", '
    '"Submission_Time", "Current_Status", "Description" '
    'FROM public."Request" WHERE "Request_ID" = :rid'
)

INCOMPLETE_EXAM_SQL = text(
    'SELECT "Request_ID", "Reason", "Proof", "Missed_Exam_Date", '
    '"Missed_Exam_Time", "Course_ID", "Section_ID", "Term", "Exam_Type", "Proof_Files" '
    'FROM public."Incomplete_Exam" WHERE "Request_ID" = :rid'
)

STUDENT_SQL = text('SELECT "Student_ID", "Student_Name" FROM public."Student" WHERE "Student_ID" = :sid')

ENROLLMENT_SQL = text(
    'SELECT "Student_ID", "Course_ID", "Section_ID", "Term", "Grade" '
    'FROM public."Takes" '
    'WHERE "Student_ID" = :sid AND "Course_ID" = :cid '
    'AND "Section_ID" = :secid AND "Term" = :term'
)


@dataclass(frozen=True)
class IncompleteExamRequestData:
    request: dict
    student: dict
    enrollment: dict | None

    @property
    def proof_paths(self) -> list[str]:
        return list(self.request.get("Proof_Files") or [])


def fetch_incomplete_exam_request_data(conn: Connection, request_id: str) -> IncompleteExamRequestData:
    request_row = conn.execute(REQUEST_SQL, {"rid": request_id}).mappings().first()
    if request_row is None:
        raise RequestNotFoundError(f"No Request found for Request_ID={request_id!r}.")
    if request_row["Request_Type"] != INCOMPLETE_EXAM:
        raise NotIncompleteExamRequestError(
            f"Request_ID={request_id!r} has Request_Type={request_row['Request_Type']!r}, expected 'Incomplete Exam'."
        )

    exam_row = conn.execute(INCOMPLETE_EXAM_SQL, {"rid": request_id}).mappings().first()
    if exam_row is None:
        raise IncompleteExamDetailsMissingError(
            f"Request_ID={request_id!r} is an Incomplete Exam request but has no Incomplete_Exam details."
        )
    request = {**dict(request_row), **dict(exam_row)}

    student_row = conn.execute(STUDENT_SQL, {"sid": request["Student_ID"]}).mappings().first()
    if student_row is None:
        raise StudentNotFoundError(f"No Student found for the student of Request_ID={request_id!r}.")

    enrollment_row = conn.execute(
        ENROLLMENT_SQL,
        {"sid": request["Student_ID"], "cid": request["Course_ID"], "secid": request["Section_ID"],
         "term": request["Term"]},
    ).mappings().first()

    return IncompleteExamRequestData(
        request=request,
        student=dict(student_row),
        enrollment=dict(enrollment_row) if enrollment_row is not None else None,
    )


def get_incomplete_exam_request_data(request_id: str) -> IncompleteExamRequestData:
    with read_only() as conn:
        return fetch_incomplete_exam_request_data(conn, request_id)


def has_incomplete_exam_details(conn: Connection, request_id: str) -> bool:
    """For the 'details missing' state: True when an Incomplete_Exam row exists."""
    return conn.execute(
        text('SELECT 1 FROM public."Incomplete_Exam" WHERE "Request_ID" = :rid LIMIT 1'), {"rid": request_id}
    ).first() is not None

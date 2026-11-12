"""Course Substitution request data, read directly by the backend.

Replaces the standalone services/database.py and config.py. The same queries,
with quoted identifiers and bound parameters, run as the backend's own role
(app.core.database.read_only) in ONE read-only transaction that is closed
before any Gemini call. The result has the standalone shape of
get_course_substitution_request, without the columns that are no longer read.

Changes:
- Student_Email, CGPA, Completed_Hours (Student) and Credit_Hours (Course) are
  not read, so student.student_email, student.cgpa, student.completed_hours and
  the courses' credit_hours are gone. No check used them.
- The Request query no longer filters on Request_Type. A missing request, a
  request of another type and a request without Course_Substitution details
  are three distinct errors (instead of None, None and ValueError).
- A missing student or course, and an empty request ID, raise this agent's
  data errors instead of ValueError.

Database access this needs (Phase 2, not installed yet): SELECT on
Course_Substitution (Request_ID, Original_Course_ID, Proposed_Course_ID,
Reason) plus a backend read policy. Request, Student, Course and Takes are
already read by existing backend code.
"""

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.database import read_only

from .eligibility_checks import get_current_term
from .exceptions import (
    CourseNotFoundError, CourseSubstitutionDetailsMissingError, EmptyRequestIdError,
    NotCourseSubstitutionRequestError, RequestNotFoundError, StudentNotFoundError,
)

COURSE_SUBSTITUTION = "Course Substitution"

REQUEST_SQL = text(
    'SELECT "Request_ID", "Request_Type", "Request_Date", "Submission_Time", '
    '"Description", "Current_Status", "Student_ID" '
    'FROM public."Request" WHERE "Request_ID" = :rid'
)

SUBSTITUTION_SQL = text(
    'SELECT "Original_Course_ID", "Proposed_Course_ID", "Reason" '
    'FROM public."Course_Substitution" WHERE "Request_ID" = :rid LIMIT 1'
)

STUDENT_SQL = text(
    'SELECT "Student_ID", "Student_Name", "Program_ID", "Program_Name", "Expected_Graduation_Term" '
    'FROM public."Student" WHERE "Student_ID" = :sid'
)

COURSE_SQL = text('SELECT "Course_ID", "Course_Name" FROM public."Course" WHERE "Course_ID" = :cid')

COMPLETION_SQL = text(
    'SELECT DISTINCT "Course_ID" FROM public."Takes" '
    'WHERE "Student_ID" = :sid AND "Course_ID" IN (:original, :proposed) '
    "AND \"Grade\" IN ('A', 'B+', 'B', 'C+', 'C', 'D+', 'D')"
)


def fetch_course_substitution_request(conn: Connection, request_id: str) -> dict:
    """Reads one Course Substitution request on an open connection."""
    if not request_id or not request_id.strip():
        raise EmptyRequestIdError("Request ID cannot be empty.")
    request_id = request_id.strip()

    request_row = conn.execute(REQUEST_SQL, {"rid": request_id}).mappings().first()
    if request_row is None:
        raise RequestNotFoundError(f"No Request found for Request_ID={request_id!r}.")
    if request_row["Request_Type"] != COURSE_SUBSTITUTION:
        raise NotCourseSubstitutionRequestError(
            f"Request_ID={request_id!r} has Request_Type={request_row['Request_Type']!r}, "
            "expected 'Course Substitution'."
        )

    substitution_row = conn.execute(SUBSTITUTION_SQL, {"rid": request_id}).mappings().first()
    if substitution_row is None:
        raise CourseSubstitutionDetailsMissingError(
            f"Course Substitution details not found for request {request_id}."
        )
    original_id = substitution_row["Original_Course_ID"]
    proposed_id = substitution_row["Proposed_Course_ID"]

    student_id = request_row["Student_ID"]
    student_row = conn.execute(STUDENT_SQL, {"sid": student_id}).mappings().first()
    if student_row is None:
        raise StudentNotFoundError(f"No Student found for the student of Request_ID={request_id!r}.")

    original_row = conn.execute(COURSE_SQL, {"cid": original_id}).mappings().first()
    proposed_row = conn.execute(COURSE_SQL, {"cid": proposed_id}).mappings().first()
    if original_row is None:
        raise CourseNotFoundError(f"Original course {original_id} was not found.")
    if proposed_row is None:
        raise CourseNotFoundError(f"Proposed course {proposed_id} was not found.")

    completed_rows = conn.execute(
        COMPLETION_SQL, {"sid": student_id, "original": original_id, "proposed": proposed_id}
    ).mappings().all()
    completed_ids = {row["Course_ID"] for row in completed_rows}

    return {
        "request_id": request_row["Request_ID"],
        "request_type": request_row["Request_Type"],
        "request_date": request_row["Request_Date"],
        "submission_time": request_row["Submission_Time"],
        "description": request_row["Description"],
        "current_status": request_row["Current_Status"],
        "student": {
            "student_id": student_row["Student_ID"],
            "student_name": student_row["Student_Name"],
            "program_id": student_row["Program_ID"],
            "program_name": student_row["Program_Name"],
            "expected_graduation_term": student_row["Expected_Graduation_Term"],
        },
        "original_course": {
            "course_id": original_row["Course_ID"],
            "course_name": original_row["Course_Name"],
        },
        "proposed_course": {
            "course_id": proposed_row["Course_ID"],
            "course_name": proposed_row["Course_Name"],
        },
        "reason": substitution_row["Reason"],
        "course_completion": {
            "original_course_completed": original_id in completed_ids,
            "proposed_course_completed": proposed_id in completed_ids,
        },
        "current_term": get_current_term(),
    }


def get_course_substitution_request(request_id: str) -> dict:
    """Retrieve the information required to evaluate a Course Substitution
    request, in one read-only transaction."""
    with read_only() as conn:
        return fetch_course_substitution_request(conn, request_id)

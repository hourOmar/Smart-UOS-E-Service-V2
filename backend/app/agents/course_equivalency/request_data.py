"""Course Equivalency request data, read directly by the backend.

Replaces the standalone services/database.py and tools/request_tools.py, student_tools.py,
course_tools.py and the database side of plan_tools.py: fixed SQL with quoted identifiers
and bound parameters, run as smart_uos_backend (app.core.database.read_only) in ONE
read-only transaction that is closed before any Storage or Gemini call. The results keep
the standalone shapes (request / student / transcript / courses dictionaries).

Access this needs (installed by Phase 4A and earlier phases, all RLS-protected):
Request, Course_Equivalency (12 columns), Student, Takes, Course, Program, Program_Change,
Program_Study_Plan_Course, Program_Study_Plan_Total, Course_Equivalency_Syllabus and
agents.course_equivalency_evaluation (earlier syllabus hashes).
"""

from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.database import read_only

from . import plan_tools
from .exceptions import (
    CourseEquivalencyDetailsMissingError, CourseNotFoundError, NotCourseEquivalencyRequestError, RequestNotFoundError,
    StudentNotFoundError,
)
from .policy import classify_grade

COURSE_EQUIVALENCY = "Course Equivalency"

REQUEST_SQL = text(
    'SELECT "Request_ID", "Student_ID", "Request_Type", "Request_Date", "Current_Status" '
    'FROM public."Request" WHERE "Request_ID" = :rid'
)
DETAILS_SQL = text(
    'SELECT "Request_ID", "Old_Course_ID", "New_Course_ID", "Reason", "Program_Change_Request_ID", '
    '"Old_Program_ID", "Old_Program_Name", "New_Program_ID", "New_Program_Name", "Plan_Version", '
    '"Old_Course_Grade", "Old_Course_Term" FROM public."Course_Equivalency" WHERE "Request_ID" = :rid'
)
STUDENT_SQL = text(
    'SELECT "Student_ID", "Student_Name", "CGPA", "Completed_Hours", "Program_ID", "Program_Name" '
    'FROM public."Student" WHERE "Student_ID" = :sid'
)
TRANSCRIPT_SQL = text(
    'SELECT "Course_ID", "Section_ID", "Term", "Grade" FROM public."Takes" WHERE "Student_ID" = :sid'
)
COURSE_SQL = text('SELECT "Course_ID", "Course_Name", "Credit_Hours" FROM public."Course" WHERE "Course_ID" = :cid')
SYLLABI_SQL = text(
    'SELECT "Syllabus_ID"::text AS syllabus_id, "Side" AS side, "Storage_Path" AS storage_path, '
    '"File_Name" AS file_name, "Mime_Type" AS mime_type, "Size_Bytes" AS size_bytes, "Sha256" AS sha256, '
    '"Source" AS source FROM public."Course_Equivalency_Syllabus" '
    'WHERE "Request_ID" = :rid AND "Is_Current" ORDER BY "Side"'
)
KNOWN_HASHES_SQL = text(
    "SELECT e.evaluated_syllabi FROM agents.course_equivalency_evaluation e "
    "WHERE e.request_id = :rid AND e.evaluated_syllabi IS NOT NULL ORDER BY e.started_at, e.id"
)

# Course_Equivalency columns passed along as context, as the standalone passed its other columns.
CONTEXT_COLUMNS = ("Program_Change_Request_ID", "Old_Program_ID", "Old_Program_Name", "New_Program_ID",
                   "New_Program_Name", "Plan_Version", "Old_Course_Grade", "Old_Course_Term")

# Phase 2A grade order (app_private.course_equivalency_grade_rank): the best attempt wins.
_GRADE_RANK = {g: i for i, g in enumerate(("A", "B+", "B", "C+", "C", "D+", "D", "F"), start=1)}


@dataclass(frozen=True)
class CourseEquivalencyData:
    request: dict
    student: dict
    transcript: list[dict] = field(repr=False)
    courses: dict
    study_plan: dict
    program: dict
    program_info: dict
    transferred: int
    syllabi: list[dict]                       # current registry rows (references only)
    known_hashes: dict[str, str]              # Syllabus_ID -> SHA-256 recorded by earlier evaluations


def course_level(course_id) -> int | None:
    """Level taken from the course number, e.g. 1501116 -> 1 (100-level), 1501459 -> 4 (400-level)."""
    s = str(course_id)
    return int(s[-3]) if len(s) >= 3 and s[-3].isdigit() else None


def get_old_and_new_course(conn: Connection, old_course_id, new_course_id) -> dict:
    out = {}
    for label, cid in (("old", old_course_id), ("new", new_course_id)):
        row = conn.execute(COURSE_SQL, {"cid": str(cid)}).mappings().first() if cid is not None else None
        if row is None:
            # The completed course may come from outside the catalog; do not fail, mark it unverified.
            if label == "new":
                raise CourseNotFoundError("The requested course was not found in the Course catalog.")
            out[label] = {"course_id": cid, "name": None, "credit_hours": None, "level": course_level(cid), "in_catalog": False}
        else:
            out[label] = {"course_id": row["Course_ID"], "name": row["Course_Name"], "credit_hours": row["Credit_Hours"],
                          "level": course_level(row["Course_ID"]), "in_catalog": True}
    return out


def _grade_key(row: dict) -> str:
    return str(row.get("Grade") or "").strip().upper()


def find_course_in_transcript(transcript: list[dict], course_id) -> dict:
    """The old course's attempt used for the grade checks: the BEST graded attempt in the
    Phase 2A order (grade rank, then latest term, then highest section). Without a graded
    attempt (e.g. still in progress) the latest attempt is used, as the standalone used the
    first row."""
    matches = [r for r in transcript if str(r.get("Course_ID")) == str(course_id)]
    if not matches:
        return {"found": False, "grade": None, "passed": None, "term": None}
    graded = [m for m in matches if _grade_key(m) in _GRADE_RANK]
    pool = graded or list(matches)
    pool.sort(key=lambda m: str(m.get("Section_ID") or ""), reverse=True)
    pool.sort(key=lambda m: -(m.get("Term") or 0))
    if graded:
        pool.sort(key=lambda m: _GRADE_RANK[_grade_key(m)])
    best = pool[0]
    return {"found": True, "grade": best.get("Grade"), "passed": classify_grade(best.get("Grade")),
            "term": best.get("Term"), "attempts": len(matches)}


def known_hashes(rows) -> dict[str, str]:
    """Syllabus_ID -> the SHA-256 first recorded for it by an earlier evaluation."""
    out: dict[str, str] = {}
    for refs in rows:
        for ref in refs or []:
            if isinstance(ref, dict) and isinstance(ref.get("syllabus_id"), str) and isinstance(ref.get("sha256"), str):
                out.setdefault(ref["syllabus_id"], ref["sha256"])
    return out


def fetch_request_data(conn: Connection, request_id: str) -> CourseEquivalencyData:
    req = conn.execute(REQUEST_SQL, {"rid": request_id}).mappings().first()
    if req is None:
        raise RequestNotFoundError(f"No request found with Request_ID={request_id!r}.")
    if req["Request_Type"] != COURSE_EQUIVALENCY:
        raise NotCourseEquivalencyRequestError(f"Request {request_id!r} is not a Course Equivalency request.")
    ce = conn.execute(DETAILS_SQL, {"rid": request_id}).mappings().first()
    if ce is None:
        raise CourseEquivalencyDetailsMissingError(f"Request {request_id!r} has no Course Equivalency details.")
    srow = conn.execute(STUDENT_SQL, {"sid": req["Student_ID"]}).mappings().first()
    if srow is None:
        raise StudentNotFoundError("The request's student was not found.")

    request = {
        "request_id": request_id,
        "student_id": req["Student_ID"],
        "request_date": req["Request_Date"],
        "status": req["Current_Status"],
        "old_course_id": ce["Old_Course_ID"],
        "new_course_id": ce["New_Course_ID"],
        "reason": ce["Reason"],
        # The standalone took a stated grade only from columns named Old_Grade / Course_Grade /
        # Previous_Grade / Grade; Course_Equivalency has none of them.
        "stated_grade": None,
        "extra_fields": {k: ce[k] for k in CONTEXT_COLUMNS},
    }
    student = {"student_id": srow["Student_ID"], "name": srow["Student_Name"], "cgpa": srow["CGPA"],
               "completed_hours": srow["Completed_Hours"], "program_id": srow["Program_ID"],
               "program_name": srow["Program_Name"]}
    transcript = [dict(r) for r in conn.execute(TRANSCRIPT_SQL, {"sid": req["Student_ID"]}).mappings().all()]
    courses = get_old_and_new_course(conn, ce["Old_Course_ID"], ce["New_Course_ID"])

    lookup = plan_tools.PlanLookup(conn)
    program_change = plan_tools.get_program_change_context(conn, req["Student_ID"])
    plan, program = plan_tools.resolve_study_plan(lookup, student, ce["New_Course_ID"], program_change)
    program_info = plan_tools.get_program_info(conn, program["program_id"], program["program_name"])
    transferred = plan_tools.transferred_credits(conn, req["Student_ID"])

    syllabi = [dict(r) for r in conn.execute(SYLLABI_SQL, {"rid": request_id}).mappings().all()]
    hashes = known_hashes(conn.execute(KNOWN_HASHES_SQL, {"rid": request_id}).scalars().all())
    return CourseEquivalencyData(request=request, student=student, transcript=transcript, courses=courses,
                                 study_plan=plan, program=program, program_info=program_info, transferred=transferred,
                                 syllabi=syllabi, known_hashes=hashes)


def load_request_data(request_id: str) -> CourseEquivalencyData:
    with read_only() as conn:
        return fetch_request_data(conn, request_id)

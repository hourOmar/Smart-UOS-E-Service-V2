"""Everything the staff review page shows for one Raise Capacity request, read in a
single read-only transaction: request, student, transcript, evaluation state."""

from sqlalchemy import text

from app.core.database import read_only

from . import repository as repo
from .service import summarize_runs
from .tools.request import get_raise_capacity_request
from .tools.student import get_student_transcript


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


def _run_view(run: dict | None) -> dict | None:
    if run is None:
        return None
    return {
        "id": run["id"],
        "run_status": "interrupted" if run["interrupted"] else run["run_status"],
        "trigger": run["run_trigger"],
        "started_at": _iso(run["started_at"]),
        "evaluated_at": _iso(run["finished_at"]),
        "recommendation": run["recommendation"],
        "reasoning": run["reasoning"],
        "check_explanations": run["check_explanations"],
        "evidence": run["evidence"],
        "gemini_status": run["gemini_status"],
        "gemini_error": run["gemini_error"],
        "model": run["model"],
        "agent_version": run["agent_version"],
        "error_message": run["error_message"],
    }


def _relevant_course_ids(request: dict, current: dict | None) -> list[str]:
    """The requested course plus every course named in its prerequisite groups."""
    ids = {str(request["Course_ID"])}
    if current and current.get("evidence"):
        groups = current["evidence"].get("checks", {}).get("prerequisite", {}).get("required_prerequisite_groups") or []
        ids.update(str(cid) for group in groups for cid in group)
    return sorted(ids)


def get_review(request_id: str) -> dict:
    with read_only() as conn:
        request = get_raise_capacity_request(conn, request_id)

        course = conn.execute(
            text('SELECT "Course_ID", "Course_Name", "Credit_Hours" FROM public."Course" WHERE "Course_ID" = :cid'),
            {"cid": request["Course_ID"]},
        ).mappings().first()
        section = conn.execute(
            text(
                'SELECT "Current_Capacity", "Total_Capacity", "Additional_Capacity" FROM public."Section" '
                'WHERE "Section_ID" = :sid AND "Course_ID" = :cid AND "Term" = :term'
            ),
            {"sid": request["Section_ID"], "cid": request["Course_ID"], "term": request["Term"]},
        ).mappings().first()
        student = conn.execute(
            text(
                'SELECT s."Student_ID", s."Student_Name", s."Student_Email", s."CGPA", s."Completed_Hours", '
                's."Program_ID", s."Program_Name", s."Expected_Graduation_Term", p."College_Name" '
                'FROM public."Student" s LEFT JOIN public."Program" p '
                'ON p."Program_ID" = s."Program_ID" AND p."Program_Name" = s."Program_Name" '
                'WHERE s."Student_ID" = :sid'
            ),
            {"sid": request["Student_ID"]},
        ).mappings().first()
        transcript = get_student_transcript(conn, request["Student_ID"])
        runs = repo.list_runs(conn, request_id)

    summary = summarize_runs(runs)
    relevant = set(_relevant_course_ids(request, summary["current"]))

    return {
        "request": {
            "request_id": request["Request_ID"],
            "status": request["Current_Status"],
            "submitted_date": _iso(request["Request_Date"]),
            "submitted_time": _iso(request["Submission_Time"]),
            "description": request["Description"],
            "reason": request["Reason"],
            "course_id": request["Course_ID"],
            "course_name": course["Course_Name"] if course else None,
            "credit_hours": course["Credit_Hours"] if course else None,
            "section_id": request["Section_ID"],
            "term": request["Term"],
            "section_capacity": dict(section) if section else None,
        },
        "student": None if student is None else {
            "student_id": student["Student_ID"],
            "name": student["Student_Name"],
            "email": student["Student_Email"],
            "program": student["Program_Name"] or student["Program_ID"],
            "college": student["College_Name"],
            "cgpa": student["CGPA"],
            "completed_hours": student["Completed_Hours"],
            "expected_graduation_term": student["Expected_Graduation_Term"],
        },
        "transcript": [
            {
                "course_id": row["Course_ID"],
                "course_name": row["Course_Name"],
                "grade": row["Grade"],
                "term": row["Term"],
                "section_id": row["Section_ID"],
                "relevant": str(row["Course_ID"]) in relevant,
            }
            for row in transcript
        ],
        "evaluation": {
            "current": _run_view(summary["current"]),
            "latest_attempt": _run_view(summary["latest_attempt"]),
            "in_progress": summary["in_progress"],
            "run_count": summary["run_count"],
        },
    }

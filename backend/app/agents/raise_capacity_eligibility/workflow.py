"""Fixed evaluation workflow (Gemini never chooses tools and has no tool access):

    request -> student -> transcript -> course -> section
    -> prerequisite (UoS page + grade policy) -> completed hours (knowledge base)
    -> capacity (arithmetic) -> evidence package -> Gemini decision

All evidence is read in ONE read-only transaction, so it is a consistent snapshot.
"""

from datetime import datetime, timezone

from app.core.database import read_only

from . import AGENT_VERSION
from .decision import get_decision
from .exceptions import CourseNotFoundError
from .tools.capacity import evaluate_capacity, get_section_capacity
from .tools.completed_hours import evaluate_completed_hours, get_completed_hours_requirement
from .tools.course import fetch_course
from .tools.prerequisites import evaluate_prerequisite_status, get_course_prerequisites
from .tools.request import get_raise_capacity_request
from .tools.student import get_student_academic_info, get_student_transcript


def build_evidence_package(request_id: str) -> dict:
    """Collects and computes all deterministic evidence. Does NOT decide."""
    with read_only() as conn:
        request_data = get_raise_capacity_request(conn, request_id)
        student_id = request_data["Student_ID"]
        course_id = request_data["Course_ID"]
        section_id = request_data["Section_ID"]
        term = request_data["Term"]

        student = get_student_academic_info(conn, student_id)
        transcript = get_student_transcript(conn, student_id)

        course = fetch_course(conn, course_id)
        if course is None:
            raise CourseNotFoundError(f"No Course found for Course_ID={course_id}.")

        section = get_section_capacity(conn, section_id, course_id, term)

    prereq_data = get_course_prerequisites(course_id)
    prereq_eval = evaluate_prerequisite_status(prereq_data, transcript)

    hours_requirement = get_completed_hours_requirement(course_id)
    hours_eval = evaluate_completed_hours(student["Completed_Hours"], hours_requirement)

    capacity_eval = evaluate_capacity(section)

    checks = {
        "prerequisite": {
            "raw_prerequisite_text": prereq_data.get("raw_prerequisite_text"),
            "relationship_type": prereq_eval.get("relationship_type"),
            "is_pre_or_co": prereq_data.get("is_pre_or_co"),
            "required_prerequisite_groups": prereq_eval.get("required_prerequisite_groups"),
            "additional_text_conditions": prereq_eval.get("additional_text_conditions", []),
            "matched_transcript_courses": prereq_eval.get("matched_transcript_courses"),
            "passed_courses": prereq_eval.get("passed_courses"),
            "failed_or_incomplete_courses": prereq_eval.get("failed_or_incomplete_courses"),
            "never_attempted": prereq_eval.get("never_attempted"),
            "unresolved_grade_courses": prereq_eval.get("unresolved_grade_courses"),
            "satisfied": prereq_eval.get("prerequisite_satisfied"),
            "verified": prereq_eval.get("verified"),
            "source_url": prereq_data.get("source_url"),
            "source_scope": prereq_data.get("source_scope"),
            "details": prereq_eval.get("reason"),
        },
        "completed_hours": hours_eval,
        "capacity": capacity_eval,
    }

    return {
        "request_id": request_id,
        # Stored with the result for staff; removed before anything is sent to Gemini.
        "student": {"Student_ID": student["Student_ID"], "Student_Name": student["Student_Name"]},
        "course": {"Course_ID": course["Course_ID"], "Course_Name": course["Course_Name"]},
        "section_id": section_id,
        "term": term,
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "checks": checks,
    }


def evaluate_raise_capacity_request(request_id: str) -> dict:
    evidence_package = build_evidence_package(request_id)
    decision = get_decision(evidence_package)
    return {
        "request_id": request_id,
        "evidence": evidence_package,
        "recommendation": decision["recommendation"],
        "reasoning": decision["reasoning"],
        "checks": decision["checks"],
        "gemini_status": decision["status"],
        "gemini_error": decision["error"],
        "model": decision["model"],
        "agent_version": AGENT_VERSION,
    }

"""Completed-hours requirements: a LOCAL, manually curated rule set
(knowledge_base/course_completed_hours.json), separate from UoS prerequisites.
A course absent from the file has NO configured rule: not applicable, never a failure.

Fixes over the prototype (rules unchanged):
- Course IDs are compared in normalized form. The database stores Course_ID as
  text ('1501279') and the knowledge base as an integer (1501279); the prototype's
  direct comparison never matched, so configured rules were never applied.
- A student whose completed hours are not recorded cannot be checked against an
  applicable rule: the result is unresolved (satisfied = None, verified = False),
  which the decision rules route to MANUAL_REVIEW, never REJECT.
"""

import json
from pathlib import Path

from ..exceptions import KnowledgeBaseError

_KB_PATH = Path(__file__).resolve().parent.parent / "knowledge_base" / "course_completed_hours.json"


def normalize_course_id(value) -> str | None:
    """'1501279', 1501279 and ' 1501279 ' all become '1501279'."""
    if value is None:
        return None
    text_value = str(value).strip()
    return str(int(text_value)) if text_value.isdigit() else text_value


def _load_knowledge_base() -> dict:
    if not _KB_PATH.exists():
        raise KnowledgeBaseError(f"Completed-hours knowledge base file not found at {_KB_PATH.name}.")
    try:
        data = json.loads(_KB_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise KnowledgeBaseError(f"Completed-hours knowledge base file is malformed JSON: {exc}") from exc
    if not isinstance(data.get("courses"), list):
        raise KnowledgeBaseError("Completed-hours knowledge base is missing a top-level 'courses' list.")
    return data


def get_completed_hours_requirement(course_id) -> dict:
    wanted = normalize_course_id(course_id)
    for course in _load_knowledge_base()["courses"]:
        if normalize_course_id(course.get("course_id")) == wanted:
            return {
                "course_id": wanted,
                "found": True,
                "course_name": course.get("course_name"),
                "minimum_completed_hours": course.get("minimum_completed_hours"),
                "required_standing": course.get("required_standing"),
                "status": course.get("status"),
            }
    return {"course_id": wanted, "found": False}


def evaluate_completed_hours(student_completed_hours: int | None, requirement: dict) -> dict:
    if not requirement.get("found"):
        return {
            "applicable": False,
            "requirement_found": False,
            "verified": True,
            "satisfied": None,
            "student_completed_hours": student_completed_hours,
            "required_hours": None,
        }

    required_hours = requirement["minimum_completed_hours"]
    if student_completed_hours is None:
        return {
            "applicable": True,
            "requirement_found": True,
            "verified": False,
            "satisfied": None,
            "student_completed_hours": None,
            "required_hours": required_hours,
            "required_standing": requirement.get("required_standing"),
            "details": "The student's completed hours are not recorded, so this rule cannot be verified.",
        }

    return {
        "applicable": True,
        "requirement_found": True,
        "verified": True,
        "satisfied": student_completed_hours >= required_hours,
        "student_completed_hours": student_completed_hours,
        "required_hours": required_hours,
        "required_standing": requirement.get("required_standing"),
    }

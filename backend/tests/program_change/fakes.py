"""Synthetic data and fakes for the Program Change agent's offline tests.
No real student data, database or Gemini call is used anywhere."""

import json
from types import SimpleNamespace

from google.genai import errors as genai_errors

# A real catalog entry whose Program ID is shared with another program
# (0201 is also "Bachelor of Arts in Arabic for Non-Native Speakers").
REQUESTED_PROGRAM = {"program_id": "0201", "program_name": "Bachelor of Arts in Arabic Language and Literature"}
OTHER_PROGRAM_SAME_ID = "Bachelor of Arts in Arabic for Non-Native Speakers"
CURRENT_PROGRAM = {"program_id": "1501", "program_name": "Bachelor of Science in Computer Science"}

# Synthetic study plan: eight 3-credit courses (IDs not in university_courses.txt).
PLAN_COURSES = [{"course_id": f"020130{i}", "course_name": f"Plan Course {i}", "credit_hours": 3} for i in range(1, 9)]
STUDY_PLAN_REPLY = json.dumps({"program_name": REQUESTED_PROGRAM["program_name"], "courses": PLAN_COURSES})

# Two university-wide courses listed in data/university_courses.txt.
BASIC_ENGLISH = "0202111"
ARABIC_LANGUAGE = "0201102"


def course(course_id, grade, credit_hours=3, term=202401, name=None):
    return {"course_id": course_id, "course_name": name or f"Course {course_id}",
            "credit_hours": credit_hours, "grade": grade, "term": term}


def program_change_request(transcript, cgpa=3.1, completed_hours=30, request_id="STUD_TEST_000001"):
    """The JSON shape request_data.get_program_change_request returns."""
    return {
        "request_id": request_id,
        "request_type": "Program Change",
        "current_status": "In Progress",
        "current_program": dict(CURRENT_PROGRAM),
        "new_program": dict(REQUESTED_PROGRAM),
        "reason": "Synthetic reason.",
        "student": {"cgpa": cgpa, "completed_hours": completed_hours},
        "transcript": transcript,
    }


def approve_transcript():
    """24 applicable credit hours (2 university + 6 plan courses), 27 completed."""
    return [
        course(BASIC_ENGLISH, "A"), course(ARABIC_LANGUAGE, "B"),
        course("0201301", "B+"), course("0201302", "C"), course("0201303", "D"),
        course("0201304", "C+"), course("0201305", "B"), course("0201306", "A"),
        course("1501215", "A"),   # completed, not applicable to the requested program
        course("0201307", "F"),   # applicable ID but failed: not counted
    ]


def report(recommendation, extra=""):
    return ("ACADEMIC ASSESSMENT\n\nStudent:\nRequest ID: STUD_TEST_000001\n\n"
            f"Overall Assessment:\nSynthetic.{extra}\n\nRecommendation:\n\n{recommendation}\n")


class FakeTextModels:
    """Mimics google-genai's models.generate_content for plain-text replies."""

    def __init__(self, behaviours):
        self.behaviours = list(behaviours)
        self.calls = []

    def generate_content(self, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        if not self.behaviours:
            raise AssertionError("more Gemini calls than configured")
        behaviour = self.behaviours.pop(0)
        if isinstance(behaviour, Exception):
            raise behaviour
        return SimpleNamespace(text=behaviour)


def server_error(code=503, status="UNAVAILABLE"):
    return genai_errors.ServerError(code, {"message": "Server problem.", "status": status})


def client_error(code, status="INVALID_ARGUMENT"):
    return genai_errors.ClientError(code, {"message": "No.", "status": status})

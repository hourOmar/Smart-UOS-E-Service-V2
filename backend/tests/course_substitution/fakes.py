"""Synthetic data and fakes for the Course Substitution agent's offline tests.
No real student data, database or Gemini call is used anywhere."""

import datetime as dt
import json
from contextlib import contextmanager
from types import SimpleNamespace

from google.genai import errors as genai_errors

from app.agents.course_substitution_eligibility import eligibility_checks, request_data
from app.core import gemini

REQUEST_ID = "STUD_CSUB_900001"
STUDENT_ID = "U99000001"
STUDENT_NAME = "Synthetic Distinctname"
FAKE_KEY = "AIzaSyFAKE-test-key-0123456789abcdefghij"

PROGRAM_ID = "1501"
PROGRAM_NAME = "Bachelor of Science in Computer Science"
STUDY_PLAN_URL = "https://www.sharjah.ac.ae/academics/degree/undergraduate/computer-science"

# Real rows of data/course_offerings_knowledge_base.txt (used by the contract's examples).
OOD_JAVA = ("1501246", "Object Oriented Design with Java")             # Fall NO
INFO_SECURITY = ("1501459", "Information Security")                    # Fall YES
ETHICS = ("1501322", "Professional, Social and Ethical Issues in CS")  # Spring NO, Summer NO, Fall YES
PROGRAMMING_I = ("1501116", "Programming I")                           # YES in every semester
COMPUTER_ARCHITECTURE = ("1501355", "Computer Architecture")            # UNKNOWN everywhere


# --- dates ----------------------------------------------------------------------

def freeze_today(monkeypatch, day: dt.date):
    """Makes "today in Asia/Dubai" `day` for get_current_term (checks and request_data)."""

    class FrozenDatetime(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(day.year, day.month, day.day, 12, 0, tzinfo=tz)

    monkeypatch.setattr(eligibility_checks, "datetime", FrozenDatetime)


# --- requests -------------------------------------------------------------------

def make_request(original=OOD_JAVA, proposed=INFO_SECURITY, graduation=202601, completed=False,
                 program_id=PROGRAM_ID, program_name=PROGRAM_NAME):
    """The dict request_data.get_course_substitution_request returns."""
    return {
        "request_id": REQUEST_ID,
        "request_type": "Course Substitution",
        "request_date": dt.date(2026, 11, 4),
        "submission_time": dt.time(10, 30),
        "description": "Synthetic description.",
        "current_status": "In Progress",
        "student": {
            "student_id": STUDENT_ID,
            "student_name": STUDENT_NAME,
            "program_id": program_id,
            "program_name": program_name,
            "expected_graduation_term": graduation,
        },
        "original_course": {"course_id": original[0], "course_name": original[1]},
        "proposed_course": {"course_id": proposed[0], "course_name": proposed[1]},
        "reason": "Synthetic reason.",
        "course_completion": {"original_course_completed": False, "proposed_course_completed": completed},
        "current_term": None,
    }


# --- database -------------------------------------------------------------------

def db_rows(original=OOD_JAVA, proposed=INFO_SECURITY, graduation=202601, completed=(), **overrides):
    """Rows per table. Course maps Course_ID -> row; Takes lists the IDs completed
    with a passing grade (the query's own filter)."""
    rows = {
        "Request": {
            "Request_ID": REQUEST_ID, "Request_Type": "Course Substitution",
            "Request_Date": dt.date(2026, 11, 4), "Submission_Time": dt.time(10, 30),
            "Description": "Synthetic description.", "Current_Status": "In Progress", "Student_ID": STUDENT_ID,
        },
        "Course_Substitution": {
            "Original_Course_ID": original[0], "Proposed_Course_ID": proposed[0], "Reason": "Synthetic reason.",
        },
        "Student": {
            "Student_ID": STUDENT_ID, "Student_Name": STUDENT_NAME, "Program_ID": PROGRAM_ID,
            "Program_Name": PROGRAM_NAME, "Expected_Graduation_Term": graduation,
        },
        "Course": {cid: {"Course_ID": cid, "Course_Name": name} for cid, name in (original, proposed)},
        "Takes": list(completed),
    }
    rows.update(overrides)
    return rows


class FakeResult:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def first(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return list(self.rows)


class FakeConnection:
    """Answers each query by the table it reads; records (table, params, sql)."""

    TABLES = ("Course_Substitution", "Request", "Student", "Course", "Takes")

    def __init__(self, rows):
        self.rows = rows
        self.queries = []

    def execute(self, statement, params=None):
        sql = str(statement)
        table = next(t for t in self.TABLES if f'public."{t}"' in sql)
        params = dict(params or {})
        self.queries.append((table, params, sql))
        data = self.rows.get(table)
        if table == "Course":
            row = (data or {}).get(params["cid"])
            return FakeResult([row] if row else [])
        if table == "Takes":
            return FakeResult([{"Course_ID": cid} for cid in data
                               if cid in (params["original"], params["proposed"])])
        return FakeResult([data] if data else [])


def install_fake_database(monkeypatch, rows):
    conn = FakeConnection(rows)

    @contextmanager
    def fake_read_only():
        yield conn

    monkeypatch.setattr(request_data, "read_only", fake_read_only)
    return conn


# --- Gemini ---------------------------------------------------------------------

class FakeTextModels:
    """Mimics google-genai's models.generate_content for plain-text replies.
    Each behaviour is an exception to raise or the reply text (None or "" allowed)."""

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


def install_fake_gemini(monkeypatch, *behaviours, key=FAKE_KEY, fallback_models=""):
    """Configures a key and models, and replaces the shared client."""
    from app.config import get_settings

    monkeypatch.setenv("GEMINI_API_KEY", key)
    monkeypatch.setenv("GEMINI_FALLBACK_MODELS", fallback_models)
    get_settings.cache_clear()
    models = FakeTextModels(behaviours)
    monkeypatch.setattr(gemini, "get_client", lambda: SimpleNamespace(models=models))
    return models


def api_error(code, message="synthetic failure"):
    status = {400: "INVALID_ARGUMENT", 401: "UNAUTHENTICATED", 403: "PERMISSION_DENIED", 404: "NOT_FOUND",
              429: "RESOURCE_EXHAUSTED", 500: "INTERNAL", 503: "UNAVAILABLE"}.get(code, "ERROR")
    body = {"message": message, "status": status}
    return (genai_errors.ServerError if code >= 500 else genai_errors.ClientError)(code, body)


def study_plan_reply(status="PASS", classification="COMPULSORY",
                     evidence="Listed under Major Compulsory Courses.", source_url=STUDY_PLAN_URL):
    return json.dumps({"status": status, "classification": classification,
                       "evidence": evidence, "source_url": source_url})


def rejection_reply(keywords, judgment=(), **overrides):
    reply = {
        "judgment_keywords": list(judgment),
        "suggested_reasons": [
            {"tone": tone, "text": f"Your request cannot be approved ({tone}).",
             "addresses_keywords": list(keywords)}
            for tone in ("formal", "concise", "supportive")
        ],
        "conflict_note": "",
    }
    reply.update(overrides)
    return reply


def load_vocabulary():
    from app.agents.course_substitution_eligibility.rejection_keyword_tools import load_keyword_vocabulary
    return load_keyword_vocabulary()

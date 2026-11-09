"""Synthetic data and fakes for the Incomplete Exam agents' offline tests.
No real student data, database, Storage or Gemini call is used anywhere."""

import datetime as dt
from types import SimpleNamespace

from google.genai import errors as genai_errors

from app.agents.incomplete_exam.request_data import IncompleteExamRequestData

REQUEST_ID = "STUD_INCRQ_INC2_900001"
STUDENT_ID = "U99000001"
STUDENT_NAME = "Synthetic Distinctname"
TOKEN = "staff-access-token-SYNTHETIC-0123456789"

PDF = b"%PDF-1.7\nsynthetic proof document\n%%EOF"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 24
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 16


def request_row(**overrides):
    row = {
        "Request_ID": REQUEST_ID, "Student_ID": STUDENT_ID, "Request_Type": "Incomplete Exam",
        "Request_Date": dt.date(2026, 11, 4), "Submission_Time": dt.time(10, 30),
        "Current_Status": "In Progress", "Description": "I was admitted to hospital on the exam day.",
    }
    row.update(overrides)
    return row


def exam_row(**overrides):
    row = {
        "Request_ID": REQUEST_ID, "Reason": None, "Proof": "Medical report", "Missed_Exam_Date": dt.date(2026, 11, 2),
        "Missed_Exam_Time": dt.time(9, 0), "Course_ID": "1501215", "Section_ID": "21", "Term": 202610,
        "Exam_Type": "Midterm", "Proof_Files": [f"{REQUEST_ID}/medical_report.pdf"],
    }
    row.update(overrides)
    return row


def student_row():
    return {"Student_ID": STUDENT_ID, "Student_Name": STUDENT_NAME}


def enrollment_row():
    return {"Student_ID": STUDENT_ID, "Course_ID": "1501215", "Section_ID": "21", "Term": 202610, "Grade": None}


def request_data(proof_paths=None, enrollment=True, **exam_overrides):
    exam = exam_row(**exam_overrides)
    if proof_paths is not None:
        exam["Proof_Files"] = proof_paths
    return IncompleteExamRequestData(
        request={**request_row(), **exam},
        student=student_row(),
        enrollment=enrollment_row() if enrollment else None,
    )


# --- database -----------------------------------------------------------------

class FakeResult:
    def __init__(self, row):
        self.row = row

    def mappings(self):
        return self

    def first(self):
        return self.row


class FakeConnection:
    """Answers each query by the table it reads; records (table, params, sql)."""

    TABLES = ("Incomplete_Exam", "Request", "Student", "Takes")

    def __init__(self, rows):
        self.rows = rows
        self.queries = []

    def execute(self, statement, params=None):
        sql = str(statement)
        table = next(t for t in self.TABLES if f'public."{t}"' in sql)
        self.queries.append((table, dict(params or {}), sql))
        return FakeResult(self.rows.get(table))


# --- Gemini -------------------------------------------------------------------

def api_error(code):
    status = {429: "RESOURCE_EXHAUSTED", 503: "UNAVAILABLE", 400: "INVALID_ARGUMENT"}.get(code, "ERROR")
    body = {"error": {"code": code, "message": f"synthetic {code}", "status": status}}
    return (genai_errors.ServerError if code >= 500 else genai_errors.ClientError)(code, body)


class FakeModels:
    """Mimics models.generate_content. Each outcome is an exception to raise or a
    dict of field values for the requested response schema."""

    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def generate_content(self, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return SimpleNamespace(parsed=config.response_schema(**outcome), candidates=[])


class FakeClient:
    def __init__(self, outcomes):
        self.models = FakeModels(outcomes)


def decision_reply(recommendation="REJECT", **overrides):
    reply = {
        "recommendation": recommendation,
        "reasoning": "Synthetic reasoning.",
        "enrollment_explanation": "Enrolled.",
        "submission_window_explanation": "Filed within the window.",
        "proof_explanation": "The attached document was reviewed.",
        "reason_validity_explanation": "Synthetic.",
        "exam_type_explanation": "Midterm is not excluded.",
    }
    reply.update(overrides)
    return reply


def rejection_reply(**overrides):
    reply = {
        "judgment_keywords": ["proof_inconsistent_or_unverifiable"],
        "suggested_reasons": [
            {"tone": tone, "text": f"Your document could not be accepted ({tone}).",
             "addresses_keywords": ["proof_inconsistent_or_unverifiable"]}
            for tone in ("formal", "concise", "supportive")
        ],
        "conflict_note": "",
    }
    reply.update(overrides)
    return reply

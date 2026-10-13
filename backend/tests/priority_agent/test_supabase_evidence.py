"""
Unit tests for the Supabase retrieval layer (app/retrieval), using
FakeSupabaseClient so nothing here touches a live Supabase project.

Fixture data uses the confirmed real column types: Course_ID and
Program_ID are int (integer/smallint), Request_ID/Student_ID/Section_ID
are str (character varying).

Covers the required scenarios: (1) successful retrieval, (2) unknown
Request_ID, (3) non-Raise-Capacity request, (4) missing student, (5)
missing program, (6) missing course, (7) zero previous attempts, (8) one
previous attempt, (9) multiple previous attempts, (10) nullable
Completed_Hours, (11) nullable Expected_Graduation_Term — plus extra edge
cases: missing Raise_Capacity row, null vs. dangling Program_ID,
missing/mismatched Section, and the newly-confirmed nullable fields
(Description, Reason, CGPA, Grade).
"""

import pytest

from app.agents.raise_capacity_priority.retrieval.errors import (
    CourseNotFoundError,
    InvalidRequestTypeError,
    ProgramNotFoundError,
    RaiseCapacityRecordNotFoundError,
    RequestNotFoundError,
    SectionMismatchError,
    StudentNotFoundError,
)
from app.agents.raise_capacity_priority.retrieval.evidence import get_supabase_evidence
from priority_agent.fakes import FakeSupabaseClient

REQUEST_ROW = {
    "Request_ID": "REQ-1001",
    "Request_Type": "Raise Capacity",
    "Request_Date": "2026-03-01",
    "Submission_Time": "09:15:00",
    "Description": "Please raise capacity for this section.",
    "Current_Status": "Pending",
    "Student_ID": "S1001",
}
RAISE_CAPACITY_ROW = {
    "Request_ID": "REQ-1001",
    "Reason": "Needed to graduate on time.",
    "Course_ID": 1501215,
    "Section_ID": "SEC-1",
    "Term": 202510,
}
STUDENT_ROW = {
    "Student_ID": "S1001",
    "Student_Name": "Sara Ahmed",
    "Student_Email": "sara@example.com",
    "CGPA": 3.42,
    "Completed_Hours": 66,
    "Program_ID": 12,
    "Expected_Graduation_Term": 202710,
}
PROGRAM_ROW = {
    "Program_ID": 12,
    "Program_Name": "Computer Science",
    "College_Name": "College of Computing and Informatics",
}
COURSE_ROW = {
    "Course_ID": 1501215,
    "Course_Name": "Data Structures",
    "Credit_Hours": 3,
}
SECTION_ROW = {
    "Section_ID": "SEC-1",
    "Course_ID": 1501215,
    "Term": 202510,
    "Current_Capacity": 30,
    "Total_Capacity": 30,
    "Additional_Capacity": 5,
}
TAKES_ROWS = [
    {
        "Student_ID": "S1001",
        "Course_ID": 1501215,
        "Grade": "D",
        "Section_ID": "SEC-OLD",
        "Term": 202410,
    }
]


def _baseline_tables() -> dict:
    return {
        "Request": [dict(REQUEST_ROW)],
        "Raise_Capacity": [dict(RAISE_CAPACITY_ROW)],
        "Student": [dict(STUDENT_ROW)],
        "Program": [dict(PROGRAM_ROW)],
        "Course": [dict(COURSE_ROW)],
        "Section": [dict(SECTION_ROW)],
        "Takes": [dict(row) for row in TAKES_ROWS],
    }


# 1. Successful retrieval
def test_successful_retrieval():
    client = FakeSupabaseClient(_baseline_tables())
    evidence = get_supabase_evidence("REQ-1001", client=client)

    assert evidence.request.request_id == "REQ-1001"
    assert evidence.raise_capacity.course_id == 1501215
    assert isinstance(evidence.raise_capacity.course_id, int)
    assert evidence.student.student_id == "S1001"
    assert evidence.program is not None
    assert evidence.program.program_id == 12
    assert isinstance(evidence.program.program_id, int)
    assert evidence.course.course_id == 1501215
    assert evidence.section.section_id == "SEC-1"
    assert evidence.section.course_id == 1501215


def test_student_email_not_included_in_evidence():
    client = FakeSupabaseClient(_baseline_tables())
    evidence = get_supabase_evidence("REQ-1001", client=client)

    assert not hasattr(evidence.student, "student_email")


# 2. Unknown Request_ID
def test_unknown_request_id_raises():
    client = FakeSupabaseClient(_baseline_tables())

    with pytest.raises(RequestNotFoundError):
        get_supabase_evidence("MISSING", client=client)


# 3. Non-Raise-Capacity request
def test_non_raise_capacity_request_raises():
    tables = _baseline_tables()
    tables["Request"][0]["Request_Type"] = "Add/Drop"
    client = FakeSupabaseClient(tables)

    with pytest.raises(InvalidRequestTypeError):
        get_supabase_evidence("REQ-1001", client=client)


def test_missing_raise_capacity_record_raises():
    tables = _baseline_tables()
    tables["Raise_Capacity"] = []
    client = FakeSupabaseClient(tables)

    with pytest.raises(RaiseCapacityRecordNotFoundError):
        get_supabase_evidence("REQ-1001", client=client)


# 4. Missing student
def test_missing_student_raises():
    tables = _baseline_tables()
    tables["Student"] = []
    client = FakeSupabaseClient(tables)

    with pytest.raises(StudentNotFoundError):
        get_supabase_evidence("REQ-1001", client=client)


# 5. Missing program
def test_missing_program_record_raises():
    tables = _baseline_tables()
    tables["Program"] = []
    client = FakeSupabaseClient(tables)

    with pytest.raises(ProgramNotFoundError):
        get_supabase_evidence("REQ-1001", client=client)


def test_null_program_id_returns_no_program_without_error():
    tables = _baseline_tables()
    tables["Student"][0]["Program_ID"] = None
    client = FakeSupabaseClient(tables)

    evidence = get_supabase_evidence("REQ-1001", client=client)

    assert evidence.program is None


# 6. Missing course
def test_missing_course_raises():
    tables = _baseline_tables()
    tables["Course"] = []
    client = FakeSupabaseClient(tables)

    with pytest.raises(CourseNotFoundError):
        get_supabase_evidence("REQ-1001", client=client)


def test_missing_section_raises():
    tables = _baseline_tables()
    tables["Section"] = []
    client = FakeSupabaseClient(tables)

    with pytest.raises(SectionMismatchError):
        get_supabase_evidence("REQ-1001", client=client)


def test_mismatched_section_raises():
    tables = _baseline_tables()
    tables["Section"][0]["Term"] = 202520
    client = FakeSupabaseClient(tables)

    with pytest.raises(SectionMismatchError):
        get_supabase_evidence("REQ-1001", client=client)


# Regression test: Section_ID is reused across different courses/terms
# (confirmed live: 56 rows with Section_ID=61 across 33 courses and 9
# terms), so the query must filter on Section_ID + Course_ID + Term
# together. This fixture has three rows sharing Section_ID="SEC-1" with
# different Course_ID/Term combinations, plus the one that actually
# matches the request; only the exact match should ever be returned.
def test_correct_section_retrieved_when_section_id_is_reused():
    tables = _baseline_tables()
    tables["Section"] = [
        {
            "Section_ID": "SEC-1",
            "Course_ID": 1501116,  # different course, same Section_ID
            "Term": 202510,
            "Current_Capacity": 99,
            "Total_Capacity": 99,
            "Additional_Capacity": 99,
        },
        {
            "Section_ID": "SEC-1",
            "Course_ID": 1501215,  # correct course, different term
            "Term": 202410,
            "Current_Capacity": 88,
            "Total_Capacity": 88,
            "Additional_Capacity": 88,
        },
        dict(SECTION_ROW),  # the actual match: SEC-1 / 1501215 / 202510
        {
            "Section_ID": "SEC-1",
            "Course_ID": 1501279,  # another different course, same Section_ID
            "Term": 202510,
            "Current_Capacity": 77,
            "Total_Capacity": 77,
            "Additional_Capacity": 77,
        },
    ]
    client = FakeSupabaseClient(tables)

    evidence = get_supabase_evidence("REQ-1001", client=client)

    assert evidence.section.section_id == "SEC-1"
    assert evidence.section.course_id == 1501215
    assert evidence.section.term == 202510
    assert evidence.section.current_capacity == SECTION_ROW["Current_Capacity"]
    assert evidence.section.total_capacity == SECTION_ROW["Total_Capacity"]
    assert evidence.section.additional_capacity == SECTION_ROW["Additional_Capacity"]


# Regression test for the real-data bug: Course_ID is an integer in
# Postgres. A Section row and its Raise_Capacity request sharing the same
# integer Course_ID must be recognized as matching (previously, forcing
# Course_ID through a generic string type broke this comparison).
def test_matching_integer_course_id_does_not_raise_mismatch():
    client = FakeSupabaseClient(_baseline_tables())

    evidence = get_supabase_evidence("REQ-1001", client=client)

    assert evidence.section.course_id == evidence.raise_capacity.course_id


# 7. Zero previous attempts
def test_no_previous_attempts():
    tables = _baseline_tables()
    tables["Takes"] = []
    client = FakeSupabaseClient(tables)

    evidence = get_supabase_evidence("REQ-1001", client=client)

    assert evidence.previous_attempts.attempted_before is False
    assert evidence.previous_attempts.number_of_attempts == 0
    assert evidence.previous_attempts.records == []


# 8. One previous attempt
def test_one_previous_attempt():
    client = FakeSupabaseClient(_baseline_tables())

    evidence = get_supabase_evidence("REQ-1001", client=client)

    assert evidence.previous_attempts.attempted_before is True
    assert evidence.previous_attempts.number_of_attempts == 1
    assert len(evidence.previous_attempts.records) == 1
    assert evidence.previous_attempts.records[0].course_id == 1501215


# 9. Multiple previous attempts (also exercises the current-request-context
# exclusion: a Takes row sharing the request's own Section_ID/Term is kept
# in `records` but not counted as a genuine previous attempt).
def test_multiple_previous_attempts():
    tables = _baseline_tables()
    tables["Takes"] = [
        {
            "Student_ID": "S1001",
            "Course_ID": 1501215,
            "Grade": "D",
            "Section_ID": "SEC-OLD1",
            "Term": 202410,
        },
        {
            "Student_ID": "S1001",
            "Course_ID": 1501215,
            "Grade": "F",
            "Section_ID": "SEC-OLD2",
            "Term": 202420,
        },
        {
            "Student_ID": "S1001",
            "Course_ID": 1501215,
            "Grade": None,
            "Section_ID": "SEC-1",
            "Term": 202510,
        },
    ]
    client = FakeSupabaseClient(tables)

    evidence = get_supabase_evidence("REQ-1001", client=client)

    assert evidence.previous_attempts.attempted_before is True
    assert evidence.previous_attempts.number_of_attempts == 2
    assert len(evidence.previous_attempts.records) == 3
    flagged = [
        record
        for record in evidence.previous_attempts.records
        if record.matches_current_request_context
    ]
    assert len(flagged) == 1


def test_nullable_grade_preserved():
    tables = _baseline_tables()
    tables["Takes"][0]["Grade"] = None
    client = FakeSupabaseClient(tables)

    evidence = get_supabase_evidence("REQ-1001", client=client)

    assert evidence.previous_attempts.records[0].grade is None


# 10. Nullable Completed_Hours
def test_nullable_completed_hours():
    tables = _baseline_tables()
    tables["Student"][0]["Completed_Hours"] = None
    client = FakeSupabaseClient(tables)

    evidence = get_supabase_evidence("REQ-1001", client=client)

    assert evidence.student.completed_hours is None


# 11. Nullable Expected_Graduation_Term
def test_nullable_expected_graduation_term():
    tables = _baseline_tables()
    tables["Student"][0]["Expected_Graduation_Term"] = None
    client = FakeSupabaseClient(tables)

    evidence = get_supabase_evidence("REQ-1001", client=client)

    assert evidence.student.expected_graduation_term is None


def test_nullable_cgpa():
    tables = _baseline_tables()
    tables["Student"][0]["CGPA"] = None
    client = FakeSupabaseClient(tables)

    evidence = get_supabase_evidence("REQ-1001", client=client)

    assert evidence.student.cgpa is None


def test_nullable_description():
    tables = _baseline_tables()
    tables["Request"][0]["Description"] = None
    client = FakeSupabaseClient(tables)

    evidence = get_supabase_evidence("REQ-1001", client=client)

    assert evidence.request.description is None


def test_nullable_reason():
    tables = _baseline_tables()
    tables["Raise_Capacity"][0]["Reason"] = None
    client = FakeSupabaseClient(tables)

    evidence = get_supabase_evidence("REQ-1001", client=client)

    assert evidence.raise_capacity.reason is None

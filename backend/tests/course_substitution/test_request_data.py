"""request_data.py with a fake database: the standalone queries minus the dropped
columns, the distinct request states and data errors (contract sections 2.1 and 9)."""

import datetime as dt
import re

import pytest

from app.agents.course_substitution_eligibility import request_data
from app.agents.course_substitution_eligibility.exceptions import (
    CourseNotFoundError, CourseSubstitutionDetailsMissingError, EmptyRequestIdError,
    NotCourseSubstitutionRequestError, RequestNotFoundError, StudentNotFoundError,
)

from .fakes import (
    INFO_SECURITY, OOD_JAVA, PROGRAM_ID, PROGRAM_NAME, REQUEST_ID, STUDENT_ID, STUDENT_NAME, FakeConnection, db_rows,
    freeze_today, install_fake_database,
)

ALLOWED_COLUMNS = {
    "Request": {"Request_ID", "Request_Type", "Request_Date", "Submission_Time", "Description", "Current_Status",
                "Student_ID"},
    "Course_Substitution": {"Request_ID", "Original_Course_ID", "Proposed_Course_ID", "Reason"},
    "Student": {"Student_ID", "Student_Name", "Program_ID", "Program_Name", "Expected_Graduation_Term"},
    "Course": {"Course_ID", "Course_Name"},
    "Takes": {"Student_ID", "Course_ID", "Grade"},
}


def fetch(rows, request_id=REQUEST_ID):
    conn = FakeConnection(rows)
    return conn, request_data.fetch_course_substitution_request(conn, request_id)


def test_reads_the_standalone_shape_without_dropped_fields(monkeypatch):
    freeze_today(monkeypatch, dt.date(2026, 11, 11))
    conn, request = fetch(db_rows(completed=[INFO_SECURITY[0], "1501999"]))
    assert request == {
        "request_id": REQUEST_ID, "request_type": "Course Substitution", "request_date": dt.date(2026, 11, 4),
        "submission_time": dt.time(10, 30), "description": "Synthetic description.",
        "current_status": "In Progress",
        "student": {"student_id": STUDENT_ID, "student_name": STUDENT_NAME, "program_id": PROGRAM_ID,
                    "program_name": PROGRAM_NAME, "expected_graduation_term": 202601},
        "original_course": {"course_id": OOD_JAVA[0], "course_name": OOD_JAVA[1]},
        "proposed_course": {"course_id": INFO_SECURITY[0], "course_name": INFO_SECURITY[1]},
        "reason": "Synthetic reason.",
        "course_completion": {"original_course_completed": False, "proposed_course_completed": True},
        "current_term": 202601,
    }
    assert [q[0] for q in conn.queries] == ["Request", "Course_Substitution", "Student", "Course", "Course", "Takes"]
    assert conn.queries[3][1] == {"cid": OOD_JAVA[0]} and conn.queries[4][1] == {"cid": INFO_SECURITY[0]}
    assert conn.queries[5][1] == {"sid": STUDENT_ID, "original": OOD_JAVA[0], "proposed": INFO_SECURITY[0]}


def test_reads_only_the_contract_columns():
    conn, _ = fetch(db_rows())
    for table, _, sql in conn.queries:
        columns = set(re.findall(r'"([A-Za-z_]+)"', sql)) - {table}
        assert columns <= ALLOWED_COLUMNS[table], (table, columns - ALLOWED_COLUMNS[table])
    joined = " ".join(sql for _, _, sql in conn.queries)
    for dropped in ("Student_Email", "CGPA", "Completed_Hours", "Credit_Hours"):
        assert dropped not in joined


def test_passing_grades_filter_and_no_type_filter_in_sql():
    conn, _ = fetch(db_rows())
    takes_sql = conn.queries[-1][2]
    assert "\"Grade\" IN ('A', 'B+', 'B', 'C+', 'C', 'D+', 'D')" in takes_sql
    assert "DISTINCT" in takes_sql
    assert "Request_Type\" =" not in conn.queries[0][2]
    assert "LIMIT 1" in conn.queries[1][2]


def test_request_id_is_trimmed_and_must_not_be_empty():
    conn, request = fetch(db_rows(), request_id=f"  {REQUEST_ID} ")
    assert conn.queries[0][1] == {"rid": REQUEST_ID}
    for empty in ("", "   ", None):
        with pytest.raises(EmptyRequestIdError):
            request_data.fetch_course_substitution_request(FakeConnection(db_rows()), empty)


def test_unknown_request():
    conn = FakeConnection(db_rows(Request=None))
    with pytest.raises(RequestNotFoundError):
        request_data.fetch_course_substitution_request(conn, REQUEST_ID)
    assert [q[0] for q in conn.queries] == ["Request"]


def test_other_request_type_is_refused_before_reading_details():
    rows = db_rows()
    rows["Request"]["Request_Type"] = "Raise Capacity"
    conn = FakeConnection(rows)
    with pytest.raises(NotCourseSubstitutionRequestError):
        request_data.fetch_course_substitution_request(conn, REQUEST_ID)
    assert [q[0] for q in conn.queries] == ["Request"]


def test_missing_details_is_its_own_state_and_stops_reading():
    conn = FakeConnection(db_rows(Course_Substitution=None))
    with pytest.raises(CourseSubstitutionDetailsMissingError):
        request_data.fetch_course_substitution_request(conn, REQUEST_ID)
    assert [q[0] for q in conn.queries] == ["Request", "Course_Substitution"]
    assert not issubclass(CourseSubstitutionDetailsMissingError, NotCourseSubstitutionRequestError)


def test_missing_student_has_no_student_id_in_the_message():
    with pytest.raises(StudentNotFoundError) as raised:
        fetch(db_rows(Student=None))
    assert STUDENT_ID not in str(raised.value)


@pytest.mark.parametrize("missing, message", [(OOD_JAVA[0], "Original course 1501246 was not found."),
                                               (INFO_SECURITY[0], "Proposed course 1501459 was not found.")])
def test_missing_course(missing, message):
    rows = db_rows()
    del rows["Course"][missing]
    with pytest.raises(CourseNotFoundError, match=message):
        fetch(rows)


def test_get_uses_one_read_only_transaction(monkeypatch):
    conn = install_fake_database(monkeypatch, db_rows())
    request = request_data.get_course_substitution_request(REQUEST_ID)
    assert request["request_id"] == REQUEST_ID
    assert len(conn.queries) == 6

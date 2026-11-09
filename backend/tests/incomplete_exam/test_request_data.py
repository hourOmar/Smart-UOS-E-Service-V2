"""request_data.py: the standalone queries, read-only, with the Request_Type
check and the distinct 'details missing' state."""

import inspect
from contextlib import contextmanager

import pytest

from app.agents.incomplete_exam import request_data
from app.agents.incomplete_exam.exceptions import (
    IncompleteExamDetailsMissingError, NotIncompleteExamRequestError, RequestNotFoundError, StudentNotFoundError,
)

from .fakes import REQUEST_ID, STUDENT_ID, FakeConnection, enrollment_row, exam_row, request_row, student_row


def rows(**overrides):
    base = {"Request": request_row(), "Incomplete_Exam": exam_row(), "Student": student_row(), "Takes": enrollment_row()}
    base.update(overrides)
    return base


def test_reads_the_standalone_shapes():
    conn = FakeConnection(rows())
    data = request_data.fetch_incomplete_exam_request_data(conn, REQUEST_ID)
    assert data.request == {**request_row(), **exam_row()}
    assert data.student == {"Student_ID": STUDENT_ID, "Student_Name": student_row()["Student_Name"]}
    assert data.enrollment == enrollment_row()
    assert data.proof_paths == exam_row()["Proof_Files"]
    assert [q[0] for q in conn.queries] == ["Request", "Incomplete_Exam", "Student", "Takes"]
    assert conn.queries[3][1] == {"sid": STUDENT_ID, "cid": "1501215", "secid": "21", "term": 202610}


def test_unknown_request():
    conn = FakeConnection(rows(Request=None))
    with pytest.raises(RequestNotFoundError):
        request_data.fetch_incomplete_exam_request_data(conn, REQUEST_ID)
    assert len(conn.queries) == 1


def test_other_request_type_is_refused_before_reading_details():
    conn = FakeConnection(rows(Request=request_row(Request_Type="Raise Capacity")))
    with pytest.raises(NotIncompleteExamRequestError):
        request_data.fetch_incomplete_exam_request_data(conn, REQUEST_ID)
    assert [q[0] for q in conn.queries] == ["Request"]


def test_missing_details_is_its_own_state_and_stops_reading():
    conn = FakeConnection(rows(Incomplete_Exam=None))
    with pytest.raises(IncompleteExamDetailsMissingError):
        request_data.fetch_incomplete_exam_request_data(conn, REQUEST_ID)
    assert [q[0] for q in conn.queries] == ["Request", "Incomplete_Exam"]
    assert not issubclass(IncompleteExamDetailsMissingError, NotIncompleteExamRequestError)


def test_missing_student():
    with pytest.raises(StudentNotFoundError) as raised:
        request_data.fetch_incomplete_exam_request_data(FakeConnection(rows(Student=None)), REQUEST_ID)
    assert STUDENT_ID not in str(raised.value)


def test_missing_enrollment_is_evidence_not_an_error():
    data = request_data.fetch_incomplete_exam_request_data(FakeConnection(rows(Takes=None)), REQUEST_ID)
    assert data.enrollment is None


def test_empty_or_null_proof_files():
    data = request_data.fetch_incomplete_exam_request_data(
        FakeConnection(rows(Incomplete_Exam=exam_row(Proof_Files=None))), REQUEST_ID)
    assert data.proof_paths == []


def test_has_details():
    assert request_data.has_incomplete_exam_details(FakeConnection(rows()), REQUEST_ID) is True
    assert request_data.has_incomplete_exam_details(FakeConnection(rows(Incomplete_Exam=None)), REQUEST_ID) is False


def test_runs_in_one_read_only_transaction(monkeypatch):
    conn = FakeConnection(rows())
    entered = []

    @contextmanager
    def fake_read_only():
        entered.append("open")
        yield conn
        entered.append("closed")

    monkeypatch.setattr(request_data, "read_only", fake_read_only)
    request_data.get_incomplete_exam_request_data(REQUEST_ID)
    assert entered == ["open", "closed"] and len(conn.queries) == 4


def test_sql_is_fixed_qualified_and_read_only():
    source = inspect.getsource(request_data)
    for keyword in ("INSERT", "UPDATE", "DELETE", "rpc", "get_incomplete_exam_proofs"):
        assert keyword not in source
    for statement in (request_data.REQUEST_SQL, request_data.INCOMPLETE_EXAM_SQL, request_data.STUDENT_SQL,
                      request_data.ENROLLMENT_SQL):
        assert "public." in str(statement) and ":" in str(statement)
    for unneeded in ("Student_Email", "CGPA", "Completed_Hours", "Program_ID"):
        assert unneeded not in str(request_data.STUDENT_SQL)

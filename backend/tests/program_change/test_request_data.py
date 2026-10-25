"""The direct database read that replaces the get_program_change_request RPC:
the JSON shape, composite program matching, bound parameters and the
read-only transaction. A fake connection stands in for PostgreSQL."""

import json
import re
from contextlib import contextmanager

from app.agents.program_change_eligibility import request_data


class FakeResult:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


class FakeConnection:
    def __init__(self, row):
        self._row = row
        self.calls = []

    def execute(self, statement, params):
        self.calls.append((str(statement), params))
        return FakeResult(self._row)


SQL = str(request_data.PROGRAM_CHANGE_REQUEST_SQL)

# What PostgreSQL's json_build_object returns for one request (synthetic).
ROW_JSON = json.dumps({
    "request_id": "STUD_TEST_000001", "request_type": "Program Change", "current_status": "In Progress",
    "current_program": {"program_id": "1501", "program_name": "Bachelor of Science in Computer Science"},
    "new_program": {"program_id": "0201", "program_name": "Bachelor of Arts in Arabic Language and Literature"},
    "reason": "Synthetic reason.",
    "student": {"cgpa": 1.95, "completed_hours": 30},
    "transcript": [
        {"course_id": "0202111", "course_name": "Basic English", "credit_hours": 3, "grade": "A", "term": 202401},
        {"course_id": "1501100", "course_name": "Course", "credit_hours": 3, "grade": None, "term": 202402},
    ],
})


def test_returns_the_rpc_shaped_object_with_json_types():
    conn = FakeConnection((ROW_JSON,))
    data = request_data.fetch_program_change_request(conn, "STUD_TEST_000001")
    assert data == json.loads(ROW_JSON)
    assert isinstance(data["student"]["cgpa"], float) and data["student"]["cgpa"] == 1.95
    assert isinstance(data["transcript"][0]["credit_hours"], int)
    assert data["transcript"][1]["grade"] is None


def test_request_id_is_a_bound_parameter():
    conn = FakeConnection((ROW_JSON,))
    request_data.fetch_program_change_request(conn, "STUD_TEST_000001'; drop table x; --")
    sql, params = conn.calls[0]
    assert params == {"request_id": "STUD_TEST_000001'; drop table x; --"}
    assert "drop table" not in sql and ":request_id" in sql


def test_no_row_or_null_value_is_none_like_the_rpc():
    assert request_data.fetch_program_change_request(FakeConnection(None), "X") is None
    assert request_data.fetch_program_change_request(FakeConnection((None,)), "X") is None


def test_programs_are_matched_on_id_and_name():
    compact = re.sub(r"\s+", " ", SQL)
    assert ('current_program."Program_ID" = pc."Current_Program_ID" '
            'AND current_program."Program_Name" = pc."Current_Program_Name"') in compact
    assert ('new_program."Program_ID" = pc."New_Program_ID" '
            'AND new_program."Program_Name" = pc."New_Program_Name"') in compact


def test_only_program_change_requests_and_transcript_order():
    compact = re.sub(r"\s+", " ", SQL)
    assert """r."Request_Type" = 'Program Change'""" in compact
    assert 'ORDER BY t."Term", c."Course_ID"' in compact
    assert "'[]'::json" in compact


def test_json_keys_match_what_the_agent_reads():
    keys = set(re.findall(r"'([a-z_]+)',", SQL))
    assert keys == {
        "request_id", "request_type", "current_status", "current_program", "new_program",
        "program_id", "program_name", "reason", "student", "cgpa", "completed_hours", "transcript",
        "course_id", "course_name", "credit_hours", "grade", "term",
    }


def test_reads_only_the_six_tables_and_never_calls_the_rpc():
    assert "get_program_change_request" not in SQL
    tables = set(re.findall(r'public\."(\w+)"', SQL))
    assert tables == {"Request", "Program_Change", "Student", "Program", "Takes", "Course"}
    for column in ("Committee_ID", "Student_Name", "Student_Email", "Auth_User_ID"):
        assert column not in SQL


def test_get_program_change_request_uses_a_read_only_transaction(monkeypatch):
    events = []
    conn = FakeConnection((ROW_JSON,))

    @contextmanager
    def fake_read_only():
        events.append("begin")
        yield conn
        events.append("end")

    monkeypatch.setattr(request_data, "read_only", fake_read_only)
    data = request_data.get_program_change_request("STUD_TEST_000001")
    assert data["request_id"] == "STUD_TEST_000001"
    assert events == ["begin", "end"] and len(conn.calls) == 1

"""SQL of the run-history repository: bound parameters, the lock key, finishing
only running rows, failures never writing a result, JSON serialization and the
2,000-character limits. A fake connection records each statement."""

import json
import re
from datetime import date, time

import pytest

from app.agents.course_substitution_eligibility import repository as repo
from app.agents.course_substitution_eligibility.workflow import json_ready


class FakeResult:
    def __init__(self, rows=(), rowcount=1, scalar=None):
        self._rows = list(rows)
        self.rowcount = rowcount
        self._scalar = scalar

    def first(self):
        return self._rows[0] if self._rows else None

    def scalar_one(self):
        return self._scalar

    def mappings(self):
        return self

    def all(self):
        return self._rows


class FakeConnection:
    def __init__(self, result=None):
        self.result = result or FakeResult()
        self.calls = []

    def execute(self, statement, params=None):
        self.calls.append((re.sub(r"\s+", " ", str(statement)), params or {}))
        return self.result

    @property
    def sql(self):
        return self.calls[-1][0]

    @property
    def params(self):
        return self.calls[-1][1]


def outcome(**overrides):
    stored = {
        "overall_result": "NOT_ELIGIBLE", "current_term": 202601, "current_semester": "Fall",
        "checks": [{"condition": "c", "status": "FAIL", "evidence": "e"}] * 5,
        "rejection": {"status": "fallback"},
        "evidence": json_ready({"request": {"request_date": date(2026, 11, 4), "submission_time": time(10, 30)}}),
        "study_plan_model": "m-plan", "rejection_model": "m-rej", "gemini_error": None,
    }
    stored.update(overrides)
    return stored


def test_read_request_reads_only_type_and_status():
    conn = FakeConnection(FakeResult([{"Request_Type": "Course Substitution", "Current_Status": "In Progress"}]))
    assert repo.read_request(conn, "R1") == {"request_type": "Course Substitution", "current_status": "In Progress"}
    assert conn.sql == 'SELECT "Request_Type", "Current_Status" FROM public."Request" WHERE "Request_ID" = :rid'
    assert conn.params == {"rid": "R1"}
    assert repo.read_request(FakeConnection(FakeResult([])), "R1") is None


def test_has_details_reads_course_substitution():
    conn = FakeConnection(FakeResult([(1,)]))
    assert repo.has_details(conn, "R1") is True
    assert 'FROM public."Course_Substitution" WHERE "Request_ID" = :rid' in conn.sql
    assert repo.has_details(FakeConnection(FakeResult([])), "R1") is False


def test_lock_key_is_specific_to_this_agent():
    conn = FakeConnection()
    repo.lock_request(conn, "R1")
    assert "pg_advisory_xact_lock(hashtextextended(:key, 0))" in conn.sql
    assert conn.params == {"key": "course_substitution_eligibility:R1"}


def test_expire_marks_only_old_running_rows_interrupted():
    conn = FakeConnection(FakeResult(rowcount=2))
    assert repo.expire_interrupted_runs(conn, "R1") == 2
    assert "SET run_status = 'failed'" in conn.sql and "failure_kind = 'interrupted'" in conn.sql
    assert "WHERE request_id = :rid AND run_status = 'running' AND started_at < now()" in conn.sql
    assert conn.params == {"rid": "R1", "secs": 600.0, "msg": repo.INTERRUPTED_MESSAGE}


def test_start_run_inserts_an_empty_running_row():
    conn = FakeConnection(FakeResult(scalar=7))
    assert repo.start_run(conn, "R1", "rerun", "00000000-0000-0000-0000-0000000000b1", 5, "1.0.0") == 7
    assert conn.sql.startswith(f"INSERT INTO {repo.TABLE} (request_id, run_trigger, triggered_by, "
                               "triggered_by_staff_id, agent_version)")
    assert conn.params == {"rid": "R1", "run_trigger": "rerun", "uid": "00000000-0000-0000-0000-0000000000b1",
                           "staff_id": 5, "version": "1.0.0"}


def test_complete_run_only_finishes_running_rows_and_serializes_json():
    conn = FakeConnection()
    assert repo.complete_run(conn, 7, outcome()) is True
    assert "SET run_status = 'completed'" in conn.sql and conn.sql.endswith("WHERE id = :id AND run_status = 'running'")
    params = conn.params
    assert (params["overall_result"], params["current_term"], params["current_semester"]) == (
        "NOT_ELIGIBLE", 202601, "Fall")
    assert json.loads(params["evidence"]) == {"request": {"request_date": "2026-11-04", "submission_time": "10:30:00"}}
    assert json.loads(params["checks"])[0]["status"] == "FAIL"
    assert json.loads(params["rejection"]) == {"status": "fallback"}
    assert repo.complete_run(FakeConnection(FakeResult(rowcount=0)), 7, outcome()) is False


def test_complete_run_stores_sql_null_without_a_rejection_and_cuts_gemini_error():
    conn = FakeConnection()
    repo.complete_run(conn, 7, outcome(overall_result="ELIGIBLE", rejection=None, gemini_error="x" * 2500))
    assert conn.params["rejection"] is None
    assert len(conn.params["gemini_error"]) == 2000


def test_complete_run_refuses_values_that_are_not_json_ready():
    with pytest.raises(TypeError):
        repo.complete_run(FakeConnection(), 7, outcome(evidence={"request_date": date(2026, 11, 4)}))


def test_fail_run_never_writes_a_result_and_cuts_the_message():
    conn = FakeConnection()
    assert repo.fail_run(conn, 7, "technical", "y" * 3000) is True
    assert "failure_kind = :kind, error_message = :msg" in conn.sql
    for column in ("overall_result", "checks", "rejection", "evidence"):
        assert column not in conn.sql
    assert conn.sql.endswith("WHERE id = :id AND run_status = 'running'")
    assert len(conn.params["msg"]) == 2000


def test_list_runs_newest_first_with_interrupted_flag():
    conn = FakeConnection(FakeResult([{"id": 2}, {"id": 1}]))
    assert repo.list_runs(conn, "R1") == [{"id": 2}, {"id": 1}]
    assert "AS interrupted" in conn.sql and conn.sql.endswith("ORDER BY started_at DESC, id DESC")
    for column in ("overall_result", "current_term", "current_semester", "checks", "rejection", "evidence",
                   "study_plan_model", "rejection_model", "gemini_error", "agent_version"):
        assert column in conn.sql

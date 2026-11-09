"""SQL of the run-history repository: bound parameters, the lock key, finishing
only running rows, failures never writing a recommendation, JSON (NULL stays
NULL), proof references only, and the 2,000-character error limit."""

import inspect
import json
import re
from datetime import datetime, timezone

import pytest

from app.agents.incomplete_exam import repository as repo


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


PROOFS = [{"path": "R1/a.pdf", "outcome": "attached", "mime_type": "application/pdf", "bytes": 10, "sha256": "0" * 64},
          {"path": "R1/b.docx", "outcome": "skipped_unsupported_type"}]


def outcome(**overrides):
    base = {"recommendation": "REJECT", "reasoning": "Late.", "check_explanations": {"proof": "ok"},
            "deterministic_results": {"submission_window": {"satisfied": False}},
            "evidence": {"collected_at": datetime(2026, 11, 7, tzinfo=timezone.utc)},
            "proof_files": PROOFS, "rejection_explanation": {"status": "ok"},
            "assessment_model": "m1", "rejection_model": "m2"}
    base.update(overrides)
    return base


def test_read_request_reads_only_type_and_status():
    conn = FakeConnection(FakeResult([{"Request_Type": "Incomplete Exam", "Current_Status": "In Progress"}]))
    assert repo.read_request(conn, "R1") == {"request_type": "Incomplete Exam", "current_status": "In Progress"}
    assert conn.sql == 'SELECT "Request_Type", "Current_Status" FROM public."Request" WHERE "Request_ID" = :rid'
    assert repo.read_request(FakeConnection(FakeResult([])), "R1") is None


def test_has_details_checks_the_incomplete_exam_row():
    conn = FakeConnection(FakeResult([(1,)]))
    assert repo.has_details(conn, "R1") is True
    assert 'FROM public."Incomplete_Exam" WHERE "Request_ID" = :rid' in conn.sql
    assert repo.has_details(FakeConnection(FakeResult([])), "R1") is False


def test_lock_key_is_specific_to_this_agent():
    conn = FakeConnection()
    repo.lock_request(conn, "R1")
    assert "pg_advisory_xact_lock(hashtextextended(:key, 0))" in conn.sql
    assert conn.params == {"key": "incomplete_exam:R1"}


def test_expiring_interrupted_runs():
    conn = FakeConnection(FakeResult(rowcount=1))
    assert repo.expire_interrupted_runs(conn, "R1") == 1
    assert "agents.incomplete_exam_evaluation" in conn.sql
    assert "SET run_status = 'failed'" in conn.sql and "failure_kind = 'interrupted'" in conn.sql
    assert conn.params == {"rid": "R1", "secs": 600.0, "msg": repo.INTERRUPTED_MESSAGE}


def test_start_run_inserts_only_the_granted_columns():
    conn = FakeConnection(FakeResult(scalar=7))
    assert repo.start_run(conn, "R1", "first_open", "00000000-0000-0000-0000-000000000001", 100001, "1.1.0") == 7
    assert "(request_id, run_trigger, triggered_by, triggered_by_staff_id, agent_version)" in conn.sql
    assert conn.params == {"rid": "R1", "run_trigger": "first_open",
                           "uid": "00000000-0000-0000-0000-000000000001", "staff_id": 100001, "version": "1.1.0"}


def test_complete_run_stores_the_outcome_only_on_a_running_row():
    conn = FakeConnection(FakeResult(rowcount=1))
    assert repo.complete_run(conn, 7, outcome()) is True
    assert "SET run_status = 'completed'" in conn.sql and "WHERE id = :id AND run_status = 'running'" in conn.sql
    assert "failure_kind" not in conn.sql and "error_message" not in conn.sql
    params = conn.params
    assert json.loads(params["proof_files"]) == PROOFS
    assert json.loads(params["evidence"]) == {"collected_at": "2026-11-07 00:00:00+00:00"}
    assert json.loads(params["rejection_explanation"]) == {"status": "ok"}
    assert params["recommendation"] == "REJECT" and params["rejection_model"] == "m2"
    assert repo.complete_run(FakeConnection(FakeResult(rowcount=0)), 7, outcome()) is False


def test_no_rejection_is_sql_null_not_json_null():
    conn = FakeConnection(FakeResult(rowcount=1))
    repo.complete_run(conn, 7, outcome(recommendation="APPROVE", rejection_explanation=None, rejection_model=None))
    assert conn.params["rejection_explanation"] is None and conn.params["rejection_model"] is None


@pytest.mark.parametrize("bad", [
    [{"path": "R1/a.pdf", "data": b"%PDF"}],
    [{"path": "R1/a.pdf", "token": "x"}],
    ["R1/a.pdf"],
    {"path": "R1/a.pdf"},
])
def test_proof_entries_must_be_references_only(bad):
    conn = FakeConnection()
    with pytest.raises(ValueError):
        repo.complete_run(conn, 7, outcome(proof_files=bad))
    assert conn.calls == []


def test_fail_run_never_writes_a_recommendation_and_caps_the_message():
    conn = FakeConnection(FakeResult(rowcount=1))
    assert repo.fail_run(conn, 7, "technical", "x" * 5000) is True
    assert "SET run_status = 'failed'" in conn.sql and "WHERE id = :id AND run_status = 'running'" in conn.sql
    for column in ("recommendation", "reasoning", "rejection_explanation"):
        assert column not in conn.sql
    assert conn.params["kind"] == "technical" and len(conn.params["msg"]) == 2000
    assert repo.fail_run(FakeConnection(FakeResult(rowcount=0)), 7, "data", "m") is False


def test_list_runs_newest_first_with_interrupted_flag():
    rows = [{"id": 2, "run_status": "running", "interrupted": True}, {"id": 1, "run_status": "completed", "interrupted": False}]
    conn = FakeConnection(FakeResult(rows))
    assert repo.list_runs(conn, "R1") == rows
    assert "ORDER BY started_at DESC, id DESC" in conn.sql and "AS interrupted" in conn.sql
    assert "rejection_explanation" in conn.sql and "proof_files" in conn.sql
    assert conn.params == {"rid": "R1", "secs": 600.0}


def test_every_statement_uses_bound_parameters_only():
    conn = FakeConnection(FakeResult(scalar=1))
    hostile = "R1'; drop table x; --"
    repo.read_request(conn, hostile)
    repo.has_details(conn, hostile)
    repo.lock_request(conn, hostile)
    repo.expire_interrupted_runs(conn, hostile)
    repo.has_running_run(conn, hostile)
    repo.has_any_run(conn, hostile)
    repo.start_run(conn, hostile, "rerun", "00000000-0000-0000-0000-000000000001", 1, "1.1.0")
    repo.list_runs(conn, hostile)
    assert all("drop table" not in sql for sql, _ in conn.calls)


def test_repository_never_touches_requests_or_decisions():
    source = inspect.getsource(repo)
    for forbidden in ('UPDATE public."Request"', '"Decision"', 'INSERT INTO public.', "DELETE"):
        assert forbidden not in source

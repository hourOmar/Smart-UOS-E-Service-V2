"""Priority states, automatic runs, retry, failure recording and the staff API,
with the database and agent replaced by fakes (the real SQL is tested against a
local PostgreSQL separately)."""

import threading
from contextlib import contextmanager
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.exc import OperationalError, ProgrammingError

from app.agents.raise_capacity_priority import agent, service
from app.agents.raise_capacity_priority import repository as repo
from app.agents.raise_capacity_priority.agent import AgentOutcome
from app.agents.raise_capacity_priority.db_client import DatabaseClient, Query, _json_value
from app.agents.raise_capacity_priority.retrieval.errors import StudentNotFoundError
from app.agents.raise_capacity_priority.schemas.priority_decision import FinalAgentResult
from app.core import auth
from app.core.database import DatabaseUnavailableError
from app.core.gemini import GeminiUnavailableError
from app.main import app
from priority_agent.test_gemini_prompt import _evidence

RID = "STUD_RSCA_RSCA_000023"
STAFF = auth.StaffIdentity(auth_user_id="00000000-0000-0000-0000-0000000000b1", staff_id=100001)
FACTORS = {k: "x" for k in ("graduation", "degree_progress", "course_requirement", "course_availability",
                            "previous_attempts", "prerequisite", "progression")}


def result(rid=RID, priority="HIGH", **extra):
    return {"request_id": rid, "priority": priority, "reasoning": "r", "factor_explanations": FACTORS,
            "key_evidence": [], **extra}


def record(level=None, res=None, status="In Progress", rtype="Raise Capacity", has_rc=True):
    return {"request_type": rtype, "current_status": status, "has_raise_capacity": has_rc,
            "priority_level": level, "priority_result": res}


def run(run_id, status, interrupted=False, error=None):
    return {"id": run_id, "request_id": RID, "run_status": status, "run_trigger": "automatic",
            "triggered_by_staff_id": 100001, "started_at": datetime(2026, 10, 12, tzinfo=timezone.utc),
            "finished_at": None, "priority": None, "model": None, "agent_version": "1.0.0",
            "error_message": error, "interrupted": interrupted}


# -- saved values -----------------------------------------------------------------------

def test_existing_agent_shaped_value_is_saved():
    assert service.classify_saved(RID, "MEDIUM", result(priority="MEDIUM")) == ("saved", None)
    assert service.classify_saved(RID, "LOW", result(priority="LOW", extra_field=1))[0] == "saved"


def test_both_null_is_the_only_empty_case():
    assert service.classify_saved(RID, None, None) == ("empty", None)


@pytest.mark.parametrize(("level", "res", "reason"), [
    ("HIGH", None, "Only one"),
    (None, result(), "Only one"),
    ("High", result(), "not HIGH, MEDIUM"),
    ("URGENT", result(), "not HIGH, MEDIUM"),
    ("HIGH", "HIGH", "not a JSON object"),
    ("HIGH", ["HIGH"], "not a JSON object"),
    ("HIGH", {"priority": "HIGH"}, "incomplete or malformed"),
    ("HIGH", result(factor_explanations={**FACTORS, "progression": ""}), "incomplete or malformed"),
    ("HIGH", result(priority="LOW"), "do not match"),
    ("HIGH", result(rid="OTHER"), "different request"),
])
def test_partial_or_malformed_values_need_attention(level, res, reason):
    kind, why = service.classify_saved(RID, level, res)
    assert kind == "attention" and reason in why


# -- states --------------------------------------------------------------------------------

def test_saved_value_is_shown_and_never_rerun():
    state = service.build_state(RID, record("HIGH", result()), [])
    assert state["state"] == "saved" and state["priority"] == "HIGH" and state["result"]["reasoning"] == "r"
    assert not state["auto_eligible"] and not state["can_retry"]


@pytest.mark.parametrize("runs", [[], [run(1, "failed", error="x")]])
def test_needs_attention_is_never_automatic_or_retried(runs):
    state = service.build_state(RID, record("HIGH", None), runs)
    assert state["state"] == "needs_attention" and not state["auto_eligible"] and not state["can_retry"]


def test_only_in_progress_requests_without_any_run_are_automatic():
    assert service.build_state(RID, record(), [])["auto_eligible"] is True
    for status in ("Completed", "Rejected"):
        state = service.build_state(RID, record(status=status), [])
        assert state["state"] == "not_started" and not state["auto_eligible"]


def test_running_failed_and_interrupted():
    assert service.build_state(RID, record(), [run(2, "running")])["state"] == "running"
    failed = service.build_state(RID, record(), [run(2, "failed", error="Gemini request failed: x")])
    assert failed["state"] == "failed" and failed["can_retry"] and not failed["auto_eligible"]
    assert failed["last_run"]["error_message"] == "Gemini request failed: x"
    stale = service.build_state(RID, record(), [run(2, "running", interrupted=True)])
    assert stale["state"] == "failed" and stale["can_retry"]
    assert stale["last_run"]["status"] == "interrupted" and stale["last_run"]["error_message"].startswith("Interrupted")
    assert not service.build_state(RID, record(status="Completed"), [run(2, "failed", error="x")])["can_retry"]


@pytest.mark.parametrize("status", ["completed", "discarded"])
def test_earlier_finished_run_with_empty_fields_needs_attention(status):
    state = service.build_state(RID, record(), [run(2, status)])
    assert state["state"] == "needs_attention" and not state["auto_eligible"] and not state["can_retry"]


@pytest.mark.parametrize("rec", [None, record(rtype="Program Change"), record(has_rc=False)])
def test_unknown_or_other_requests_are_not_found(rec):
    assert service.build_state(RID, rec, [])["state"] == "not_found"


# -- service with a fake database ---------------------------------------------------------

class FakeDb:
    def __init__(self, records, runs=None):
        self.records = records
        self.runs = runs or {}
        self.started = []
        self.failed = {}
        self.saved = []
        self.read_error = None
        self.save_outcome = "saved"
        self.save_error = None
        self.lock = threading.Lock()
        self.next_id = 100

    @contextmanager
    def tx(self):
        with self.lock:
            yield self

    def read_requests(self, _conn, ids):
        if self.read_error:
            raise self.read_error
        return {i: self.records[i] for i in ids if i in self.records}

    def list_runs(self, _conn, ids):
        if self.read_error:
            raise self.read_error
        return {i: list(self.runs[i]) for i in ids if i in self.runs}

    def start_run(self, _conn, rid, trigger, uid, staff_id, version):
        self.next_id += 1
        self.runs.setdefault(rid, []).insert(0, run(self.next_id, "running"))
        self.started.append((rid, trigger, staff_id, version))
        return self.next_id

    def fail_run(self, _conn, run_id, message):
        self.failed[run_id] = message
        return True

    def save_result(self, _conn, run_id, priority, res, evidence, model):
        if self.save_error:
            raise self.save_error
        self.saved.append((run_id, priority, res, model, evidence))
        return self.save_outcome


@pytest.fixture
def db(monkeypatch):
    fake = FakeDb({})
    for name in ("read_requests", "list_runs", "start_run", "fail_run", "save_result"):
        monkeypatch.setattr(repo, name, getattr(fake, name))
    monkeypatch.setattr(repo, "lock_request", lambda conn, rid: None)
    monkeypatch.setattr(repo, "expire_interrupted_runs", lambda conn, rid: 0)
    monkeypatch.setattr(service, "read_only", fake.tx)
    monkeypatch.setattr(service, "write_transaction", fake.tx)
    dispatched = []
    monkeypatch.setattr(service, "_dispatch", lambda run_id, rid: dispatched.append((run_id, rid)))
    fake.dispatched = dispatched
    monkeypatch.setattr(service, "_slots", threading.BoundedSemaphore(service.MAX_PARALLEL_RUNS))
    return fake


def test_automatic_starts_only_eligible_requests(db):
    db.records = {"A": record(), "B": record("LOW", result("B", "LOW")), "C": record("HIGH", None),
                  "D": record(status="Completed"), "E": record()}
    db.runs = {"E": [run(1, "failed", error="x")]}
    out = service.start_automatic(["A", "B", "C", "D", "E", "MISSING", "A"], STAFF)
    assert out["started"] == ["A"] and db.started == [("A", "automatic", 100001, "1.0.0")]
    states = {s["request_id"]: s["state"] for s in out["priorities"]}
    assert states == {"A": "running", "B": "saved", "C": "needs_attention", "D": "not_started",
                      "E": "failed", "MISSING": "not_found"}


def test_automatic_respects_the_per_process_limit(db):
    db.records = {f"R{i}": record() for i in range(5)}
    out = service.start_automatic([f"R{i}" for i in range(5)], STAFF)
    assert out["started"] == ["R0", "R1"]
    assert [s["state"] for s in out["priorities"]] == ["running", "running", "not_started", "not_started",
                                                         "not_started"]


def test_saved_result_is_reused_and_not_started_again(db):
    db.records = {RID: record("MEDIUM", result(priority="MEDIUM"))}
    for _ in range(3):
        assert service.start_automatic([RID], STAFF)["started"] == []
    assert db.started == []


@pytest.mark.parametrize("error", [DatabaseUnavailableError("down"),
                                   ProgrammingError("SELECT", {}, Exception("permission denied"))])
def test_failed_read_starts_nothing_and_raises(db, error):
    db.records = {RID: record()}
    db.read_error = error
    with pytest.raises(type(error)):
        service.start_automatic([RID], STAFF)
    with pytest.raises(type(error)):
        service.read_states([RID])
    assert db.started == []


def test_retry_only_after_failure(db):
    db.records = {RID: record()}
    db.runs = {RID: [run(1, "failed", error="x")]}
    state = service.retry(RID, STAFF)
    assert state["state"] == "running" and db.started == [(RID, "retry", 100001, "1.0.0")]
    with pytest.raises(service.RetryRefusedError, match="already running"):
        service.retry(RID, STAFF)


@pytest.mark.parametrize(("rec", "runs", "message"), [
    (record("HIGH", result()), [], "already saved"),
    (record("HIGH", None), [], "needs attention"),
    (record(), [], "checked automatically"),
    (record(status="Completed"), [run(1, "failed", error="x")], "Only In Progress"),
])
def test_retry_refusals(db, rec, runs, message):
    db.records = {RID: rec}
    db.runs = {RID: runs}
    with pytest.raises(service.RetryRefusedError, match=message):
        service.retry(RID, STAFF)
    assert db.started == []


def test_retry_when_all_slots_are_busy(db, monkeypatch):
    monkeypatch.setattr(service, "_slots", threading.BoundedSemaphore(1))
    service._slots.acquire()
    with pytest.raises(service.BusyError):
        service.retry(RID, STAFF)


# -- executing a claimed run ----------------------------------------------------------------

def outcome(priority="HIGH"):
    return AgentOutcome(result=FinalAgentResult(**result(priority=priority)), evidence=_evidence(), model="m-1")


def test_successful_run_is_saved_with_result_evidence_and_model(db, monkeypatch):
    monkeypatch.setattr(agent, "prioritize_raise_capacity_request", lambda rid: outcome())
    assert service.execute_run(7, RID) == "saved"
    run_id, priority, res, model, evidence = db.saved[0]
    assert (run_id, priority, model) == (7, "HIGH", "m-1") and res == result()
    assert evidence["request_context"]["request_id"] == "REQ-1" and not db.failed


@pytest.mark.parametrize("outcome_text", ["discarded", "not_running"])
def test_existing_value_or_stale_run_is_reported(db, monkeypatch, outcome_text):
    monkeypatch.setattr(agent, "prioritize_raise_capacity_request", lambda rid: outcome())
    db.save_outcome = outcome_text
    assert service.execute_run(7, RID) == outcome_text and not db.failed


def _validation_error():
    try:
        FinalAgentResult.model_validate({"request_id": RID})
    except ValidationError as exc:
        return exc


@pytest.mark.parametrize(("error", "expected"), [
    (GeminiUnavailableError("Gemini request failed: ServerError 503 UNAVAILABLE: busy"), "Gemini request failed"),
    (StudentNotFoundError("No Student found for Student_ID='U21100001'."), "Evidence could not be collected"),
    (DatabaseUnavailableError("x"), "database could not be reached"),
    (OperationalError("SELECT", {}, Exception("x")), "refused a read"),
    (RuntimeError("boom U21100001"), "Unexpected error during the priority check (RuntimeError)"),
])
def test_technical_failures_are_recorded_as_failed_runs(db, monkeypatch, error, expected):
    def boom(rid):
        raise error
    monkeypatch.setattr(agent, "prioritize_raise_capacity_request", boom)
    assert service.execute_run(7, RID) == "failed"
    assert expected in db.failed[7] and "U21100001" not in db.failed[7] and not db.saved


def test_shape_errors_name_fields_not_values(db, monkeypatch):
    error = _validation_error()

    def boom(rid):
        raise error
    monkeypatch.setattr(agent, "prioritize_raise_capacity_request", boom)
    service.execute_run(7, RID)
    assert db.failed[7].startswith("Evidence did not have the expected shape (")


def test_database_refusing_the_result_is_a_failed_run(db, monkeypatch):
    monkeypatch.setattr(agent, "prioritize_raise_capacity_request", lambda rid: outcome())
    db.save_error = ProgrammingError("SELECT", {}, Exception("invalid_priority_result: x"))
    assert service.execute_run(7, RID) == "failed"
    assert db.failed[7].startswith("The result was not saved: the database refused it")


# -- read-only database client ------------------------------------------------------------------

def test_db_client_accepts_only_fixed_tables_identifiers_and_values():
    client = DatabaseClient(conn=None)
    with pytest.raises(ValueError):
        client.table("Audit_Log")
    with pytest.raises(ValueError):
        client.table("Request").select('Request_ID, "x"; drop table y').eq("Request_ID", "a").execute()
    with pytest.raises(TypeError):
        client.table("Request").eq("Request_ID", 1.5)
    with pytest.raises(TypeError):
        client.table("Request").eq("Request_ID", True)
    assert isinstance(client.table("Takes"), Query)


def test_db_client_values_are_json_shaped_like_postgrest():
    from datetime import date, time
    from decimal import Decimal
    from uuid import UUID
    assert _json_value(date(2026, 9, 21)) == "2026-09-21"
    assert _json_value(time(14, 5, 9)) == "14:05:09"
    assert _json_value(Decimal("3.5")) == 3.5
    assert _json_value(UUID(int=1)) == "00000000-0000-0000-0000-000000000001"


def test_db_client_empty_in_matches_nothing():
    assert DatabaseClient(conn=None).table("Takes").select("Course_ID").in_("Course_ID", []).execute().data == []


# -- API -----------------------------------------------------------------------------------------

@pytest.fixture
def api_client():
    app.dependency_overrides[auth.require_staff] = lambda: STAFF
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_routes_require_a_session():
    anonymous = TestClient(app)
    assert anonymous.get("/api/staff/raise-capacity/priorities", params={"request_id": RID}).status_code == 401
    assert anonymous.post("/api/staff/raise-capacity/priorities/automatic", json={"request_ids": [RID]}).status_code == 401
    assert anonymous.post(f"/api/staff/raise-capacity/{RID}/priority/retry").status_code == 401


def test_list_and_automatic(api_client, db):
    db.records = {RID: record()}
    listed = api_client.get("/api/staff/raise-capacity/priorities", params={"request_id": [RID]})
    assert listed.status_code == 200 and listed.json()["priorities"][0]["state"] == "not_started"
    assert db.started == []
    started = api_client.post("/api/staff/raise-capacity/priorities/automatic", json={"request_ids": [RID]})
    assert started.status_code == 200 and started.json()["started"] == [RID]


@pytest.mark.parametrize("error", [DatabaseUnavailableError("down"),
                                   ProgrammingError("SELECT", {}, Exception("permission denied"))])
def test_read_failure_is_503_never_an_empty_priority(api_client, db, error):
    db.read_error = error
    for response in (api_client.get("/api/staff/raise-capacity/priorities", params={"request_id": RID}),
                     api_client.post("/api/staff/raise-capacity/priorities/automatic", json={"request_ids": [RID]})):
        assert response.status_code == 503 and "priorities" not in response.json()
    assert db.started == []


def test_request_id_limits(api_client, db):
    too_many = [f"R{i}" for i in range(101)]
    assert api_client.post("/api/staff/raise-capacity/priorities/automatic", json={"request_ids": too_many}).status_code == 422
    assert api_client.post("/api/staff/raise-capacity/priorities/automatic", json={"request_ids": []}).status_code == 422
    assert api_client.get("/api/staff/raise-capacity/priorities").status_code == 422
    assert api_client.get("/api/staff/raise-capacity/priorities", params={"request_id": "x" * 65}).status_code == 422


def test_retry_responses(api_client, db):
    db.records = {RID: record()}
    db.runs = {RID: [run(1, "failed", error="x")]}
    assert api_client.post(f"/api/staff/raise-capacity/{RID}/priority/retry").status_code == 200
    assert api_client.post(f"/api/staff/raise-capacity/{RID}/priority/retry").status_code == 409
    assert api_client.post("/api/staff/raise-capacity/UNKNOWN/priority/retry").status_code == 404

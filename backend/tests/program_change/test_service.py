"""Run management for Program Change evaluations (service.py): first opening only
for In Progress requests without runs, reruns, duplicate prevention,
interrupted runs, failure classification (never a recommendation), and keeping
the last successful result. An in-memory fake repository stands in for
agents.program_change_evaluation; Gemini and the request reader are fakes."""

import copy
from contextlib import contextmanager
from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError, OperationalError

from app.agents.program_change_eligibility import (
    AGENT_VERSION, eligibility_agent, evidence, repository, service, workflow,
)
from app.agents.program_change_eligibility.exceptions import (
    NotProgramChangeRequestError, RequestNotFoundError, RerunNotAllowedError, RunInProgressError,
)
from app.config import get_settings
from app.core import gemini
from app.core.auth import StaffIdentity
from app.core.database import DatabaseUnavailableError
from app.core.gemini import GeminiUnavailableError

from .fakes import STUDY_PLAN_REPLY, FakeTextModels, approve_transcript, program_change_request, report

RID = "STUD_TEST_000001"
STAFF = StaffIdentity(auth_user_id="00000000-0000-0000-0000-0000000000b1", staff_id=100001)


class UniqueViolation(Exception):
    sqlstate = "23505"


class FakeRepo:
    """Behaves like the table: one running row per request, finished rows final."""
    MAX_ERROR_LENGTH = repository.MAX_ERROR_LENGTH
    INTERRUPTED_MESSAGE = repository.INTERRUPTED_MESSAGE

    def __init__(self, status="In Progress", request_type="Program Change"):
        self.requests = {RID: {"request_type": request_type, "current_status": status}}
        self.runs: list[dict] = []
        self.locks: list[str] = []
        self.race_on_start = False

    def read_request(self, conn, rid):
        return self.requests.get(rid)

    def lock_request(self, conn, rid):
        self.locks.append(rid)

    def expire_interrupted_runs(self, conn, rid):
        expired = 0
        for run in self.runs:
            if run["request_id"] == rid and run["run_status"] == "running" and run.pop("_stale", False):
                run.update(run_status="failed", finished_at=_now(), failure_kind="interrupted",
                           error_message=self.INTERRUPTED_MESSAGE)
                expired += 1
        return expired

    def has_running_run(self, conn, rid):
        return any(r["request_id"] == rid and r["run_status"] == "running" for r in self.runs)

    def has_any_run(self, conn, rid):
        return any(r["request_id"] == rid for r in self.runs)

    def start_run(self, conn, rid, trigger, uid, staff_id, version):
        if self.race_on_start:
            raise IntegrityError("INSERT", {}, UniqueViolation())
        assert not self.has_running_run(conn, rid), "the unique index would refuse this"
        run = {"id": len(self.runs) + 1, "request_id": rid, "run_status": "running", "run_trigger": trigger,
               "triggered_by": uid, "triggered_by_staff_id": staff_id, "started_at": _now(), "finished_at": None,
               "recommendation": None, "report": None, "deterministic_results": None, "evidence": None,
               "study_plan_model": None, "assessment_model": None, "agent_version": version,
               "failure_kind": None, "error_message": None}
        self.runs.append(run)
        return run["id"]

    def _running(self, run_id):
        run = next(r for r in self.runs if r["id"] == run_id)
        return run if run["run_status"] == "running" else None

    def complete_run(self, conn, run_id, outcome):
        run = self._running(run_id)
        if run is None:
            return False
        run.update(run_status="completed", finished_at=_now(), **outcome)
        return True

    def fail_run(self, conn, run_id, kind, message):
        run = self._running(run_id)
        if run is None:
            return False
        run.update(run_status="failed", finished_at=_now(), failure_kind=kind, error_message=message[:2000])
        return True

    def list_runs(self, conn, rid):
        rows = [dict(r, interrupted=bool(r.get("_stale")) and r["run_status"] == "running")
                for r in self.runs if r["request_id"] == rid]
        return sorted(rows, key=lambda r: r["id"], reverse=True)


def _now():
    return datetime.now(timezone.utc)


@contextmanager
def _no_db():
    yield None


@pytest.fixture
def repo(monkeypatch):
    def install(**kwargs):
        fake = FakeRepo(**kwargs)
        monkeypatch.setattr(service, "repo", fake)
        monkeypatch.setattr(service, "read_only", _no_db)
        monkeypatch.setattr(service, "write_transaction", _no_db)
        return fake
    return install


@pytest.fixture
def agent_run(monkeypatch):
    """Replaces the workflow with one that returns `outcome` or raises it; returns
    the calls made to this replacement only."""
    def install(outcome):
        calls = []

        def fake(request_id):
            calls.append(request_id)
            if isinstance(outcome, BaseException):
                raise outcome
            return outcome
        monkeypatch.setattr(workflow, "evaluate_program_change_request", fake)
        return calls
    return install


def success(recommendation="APPROVE", results=None):
    return workflow.WorkflowOutcome(
        found=True,
        result={"request_id": RID, "report": f"Report.\n\n{recommendation}", "agent_recommendation": recommendation,
                "deterministic_results": results if results is not None else {"applicable_hours": 24, "cgpa": 3.1}},
        evidence={"request_id": RID, "reference_files": []},
        study_plan_model="m-plan", assessment_model="m-assess")


# -- first opening and reruns ---------------------------------------------------------------

def test_first_opening_of_an_in_progress_request_runs_and_saves_everything(repo, agent_run):
    fake = repo()
    agent_run(success("REQUIRES_REVIEW"))
    outcome = service.ensure_evaluation(RID, STAFF, rerun=False)
    assert (outcome.started, outcome.reason) == (True, "started")
    [run] = fake.runs
    assert run["run_status"] == "completed" and run["run_trigger"] == "first_open"
    assert run["recommendation"] == "REQUIRES_REVIEW" and run["report"].endswith("REQUIRES_REVIEW")
    assert run["deterministic_results"] == {"applicable_hours": 24, "cgpa": 3.1}
    assert run["evidence"] == {"request_id": RID, "reference_files": []}
    assert (run["study_plan_model"], run["assessment_model"]) == ("m-plan", "m-assess")
    assert run["triggered_by_staff_id"] == 100001 and run["agent_version"] == AGENT_VERSION
    assert run["failure_kind"] is None and run["error_message"] is None
    assert fake.locks == [RID]


@pytest.mark.parametrize("status", ["Completed", "Rejected", "Draft"])
def test_first_opening_never_runs_for_requests_not_in_progress(repo, agent_run, status):
    fake = repo(status=status)
    calls = agent_run(success())
    outcome = service.ensure_evaluation(RID, STAFF, rerun=False)
    assert (outcome.started, outcome.reason) == (False, "not_in_progress")
    assert fake.runs == [] and calls == []


def test_first_opening_does_not_run_again_after_any_previous_run(repo, agent_run):
    fake = repo()
    agent_run(GeminiUnavailableError("Gemini request failed: ServerError 503"))
    service.ensure_evaluation(RID, STAFF, rerun=False)          # failed first attempt
    calls = agent_run(success())
    outcome = service.ensure_evaluation(RID, STAFF, rerun=False)
    assert (outcome.started, outcome.reason) == (False, "already_evaluated")
    assert len(fake.runs) == 1 and calls == []


def test_rerun_of_an_in_progress_request_runs(repo, agent_run):
    fake = repo()
    agent_run(success("REJECT"))
    outcome = service.ensure_evaluation(RID, STAFF, rerun=True)
    assert outcome.started is True
    assert fake.runs[0]["run_trigger"] == "rerun" and fake.runs[0]["recommendation"] == "REJECT"


@pytest.mark.parametrize("status", ["Completed", "Rejected"])
def test_rerun_of_a_finalized_request_is_refused_under_the_lock(repo, agent_run, status):
    fake = repo(status=status)
    calls = agent_run(success())
    with pytest.raises(RerunNotAllowedError):
        service.ensure_evaluation(RID, STAFF, rerun=True)
    assert fake.runs == [] and calls == []
    assert fake.locks == [RID]                 # decided while holding the request's lock
    assert service.read_evaluation(RID)["can_rerun"] is False


def test_status_change_after_the_check_is_seen_under_the_lock(repo, agent_run):
    fake = repo()
    real_lock = fake.lock_request

    def lock_then_finalize(conn, rid):         # the request is decided just before we get the lock
        real_lock(conn, rid)
        fake.requests[rid]["current_status"] = "Completed"
    fake.lock_request = lock_then_finalize
    calls = agent_run(success())
    with pytest.raises(RerunNotAllowedError):
        service.ensure_evaluation(RID, STAFF, rerun=True)
    assert service.ensure_evaluation(RID, STAFF, rerun=False).reason == "not_in_progress"
    assert fake.runs == [] and calls == []


# -- duplicate prevention ---------------------------------------------------------------------

def test_while_a_run_is_in_progress(repo, agent_run):
    fake = repo()
    fake.start_run(None, RID, "first_open", STAFF.auth_user_id, 1, "1.0.0")   # another process is running it
    calls = agent_run(success())
    outcome = service.ensure_evaluation(RID, STAFF, rerun=False)
    assert (outcome.started, outcome.in_progress, outcome.reason) == (False, True, "running")
    with pytest.raises(RunInProgressError):
        service.ensure_evaluation(RID, STAFF, rerun=True)
    assert len(fake.runs) == 1 and calls == []


def test_unique_index_race_is_treated_as_already_running(repo, agent_run):
    fake = repo()
    fake.race_on_start = True
    calls = agent_run(success())
    assert service.ensure_evaluation(RID, STAFF, rerun=False).reason == "running"
    with pytest.raises(RunInProgressError):
        service.ensure_evaluation(RID, STAFF, rerun=True)
    assert calls == []


def test_other_integrity_errors_are_not_hidden(repo, agent_run):
    fake = repo()

    class OtherError(Exception):
        sqlstate = "23503"   # foreign key, not the one-running index

    def start(*args):
        raise IntegrityError("INSERT", {}, OtherError())
    fake.start_run = start
    agent_run(success())
    with pytest.raises(IntegrityError):
        service.ensure_evaluation(RID, STAFF, rerun=True)


def test_an_interrupted_run_is_expired_and_a_rerun_starts(repo, agent_run):
    fake = repo()
    fake.start_run(None, RID, "first_open", STAFF.auth_user_id, 1, "1.0.0")
    fake.runs[0]["_stale"] = True                          # running for more than 10 minutes
    view = service.read_evaluation(RID)["latest_attempt"]
    assert view["run_status"] == "interrupted" and view["failure_kind"] == "interrupted"
    agent_run(success())
    assert service.ensure_evaluation(RID, STAFF, rerun=True).started is True
    first, second = fake.runs
    assert (first["run_status"], first["failure_kind"]) == ("failed", "interrupted")
    assert first["recommendation"] is None and second["run_status"] == "completed"


def test_a_result_arriving_after_expiry_is_discarded(repo, monkeypatch):
    fake = repo()

    def slow_run(request_id):
        fake.runs[-1].update(run_status="failed", failure_kind="interrupted",
                             error_message=fake.INTERRUPTED_MESSAGE)   # expired meanwhile
        return success()
    monkeypatch.setattr(workflow, "evaluate_program_change_request", slow_run)
    service.ensure_evaluation(RID, STAFF, rerun=True)
    assert fake.runs[0]["run_status"] == "failed" and fake.runs[0]["recommendation"] is None


# -- failures ---------------------------------------------------------------------------------------

def _genuine_missing_grade_error():
    # The agent now skips NULL grades, so this safety net is exercised with an
    # AttributeError raised from a function of the same name, as the agent's
    # earlier version raised it.
    def is_completed_grade(grade):
        return grade.strip()

    try:
        is_completed_grade(None)
    except AttributeError as exc:
        return exc
    raise AssertionError("expected AttributeError")


@pytest.mark.parametrize("error, kind, message", [
    (GeminiUnavailableError("Gemini request failed on every configured model: m1: 503"), "technical",
     "Gemini request failed on every configured model: m1: 503"),
    (DatabaseUnavailableError("down"), "technical", "The database could not be reached while collecting evidence."),
    (OperationalError("SELECT", {}, Exception("x")), "technical",
     "The database refused a read while collecting evidence (OperationalError)."),
    (ValueError("Unknown grade: WF"), "data", "Unknown grade: WF"),
    (ValueError("CGPA is missing."), "data", "CGPA is missing."),
    (ValueError("Expected exactly one catalog entry for Program ID '0201' and program name 'X', but found 0. "
                "Check data/bachelors_program_catalog.txt."), "data", None),
    (ValueError("Program mismatch: expected 'A', but Gemini returned 'B'. The study plan will not be used."),
     "technical", None),
    (ValueError("Gemini returned invalid JSON for https://example.test.\nResponse:\nnot json"), "technical", None),
    (ValueError("Gemini report does not contain a valid recommendation."), "technical", None),
    (ValueError("Gemini report contains contradictory recommendations: APPROVE, REJECT."), "technical", None),
    (ValueError("Gemini report contains an unsupported recommendation value."), "technical", None),
    (ValueError("Gemini returned an empty academic assessment."), "technical", None),
    (_genuine_missing_grade_error(), "data", service.MISSING_GRADE_MESSAGE),
    (KeyError("current_program"), "technical", "Unexpected error during the eligibility check (KeyError)."),
])
def test_failures_are_classified_and_never_carry_a_recommendation(repo, agent_run, error, kind, message):
    fake = repo()
    agent_run(error)
    assert service.ensure_evaluation(RID, STAFF, rerun=False).started is True
    [run] = fake.runs
    assert run["run_status"] == "failed" and run["failure_kind"] == kind
    assert run["recommendation"] is None and run["report"] is None
    assert run["error_message"] and len(run["error_message"]) <= 2000
    if message is not None:
        assert run["error_message"] == message


def test_unreadable_program_change_details_are_a_data_failure(repo, agent_run):
    fake = repo()
    agent_run(workflow.WorkflowOutcome(found=False, result={"request_id": RID, "status": "NOT_FOUND"}))
    service.ensure_evaluation(RID, STAFF, rerun=False)
    run = fake.runs[0]
    assert (run["run_status"], run["failure_kind"]) == ("failed", "data")
    assert run["error_message"] == service.NOT_FOUND_MESSAGE and run["recommendation"] is None


def test_failure_messages_are_sanitized_and_limited(monkeypatch, repo, agent_run):
    key = "AIzaSyFAKE-test-key-0123456789abcdefghij"
    monkeypatch.setenv("GEMINI_API_KEY", key)
    get_settings.cache_clear()
    fake = repo()
    agent_run(ValueError(f"Gemini returned invalid JSON (key={key}) for student U21100001: " + "x" * 5000))
    service.ensure_evaluation(RID, STAFF, rerun=False)
    message = fake.runs[0]["error_message"]
    assert key not in message and "U21100001" not in message and len(message) <= 2000

    agent_run(GeminiUnavailableError("Gemini request failed on every configured model: " + "m: 503; " * 500))
    service.ensure_evaluation(RID, STAFF, rerun=True)
    assert len(fake.runs[1]["error_message"]) == 2000


# -- the last successful result is kept ------------------------------------------------------------

def test_a_failed_rerun_never_hides_the_last_successful_result(repo, agent_run):
    repo()
    agent_run(success("APPROVE"))
    service.ensure_evaluation(RID, STAFF, rerun=False)
    agent_run(GeminiUnavailableError("Gemini request failed: ServerError 503"))
    service.ensure_evaluation(RID, STAFF, rerun=True)

    state = service.read_evaluation(RID)
    assert state["current"]["run_status"] == "completed" and state["current"]["recommendation"] == "APPROVE"
    assert state["latest_attempt"]["run_status"] == "failed"
    assert state["latest_attempt"]["failure_kind"] == "technical"
    assert state["latest_attempt"]["recommendation"] is None
    assert state["run_count"] == 2 and state["in_progress"] is False and state["auto_run_eligible"] is False


def test_a_newer_successful_rerun_becomes_current(repo, agent_run):
    repo()
    agent_run(success("APPROVE"))
    service.ensure_evaluation(RID, STAFF, rerun=False)
    agent_run(success("REJECT"))
    service.ensure_evaluation(RID, STAFF, rerun=True)
    state = service.read_evaluation(RID)
    assert state["current"]["recommendation"] == "REJECT" and state["latest_attempt"] is None


@pytest.mark.parametrize("status, eligible", [("In Progress", True), ("Completed", False)])
def test_read_evaluation_without_runs(repo, status, eligible):
    repo(status=status)
    state = service.read_evaluation(RID)
    assert state["current"] is None and state["latest_attempt"] is None and state["run_count"] == 0
    assert state["auto_run_eligible"] is eligible and state["request_status"] == status


# -- structured eligibility results ----------------------------------------------------------------

def structured(cgpa=3.72, cgpa_ok=True, hours=24, hours_ok=True, completed=30):
    """deterministic_results as agent 1.1.0 stores them."""
    return {"cgpa": cgpa, "cgpa_eligible": cgpa_ok, "completed_hours": completed, "applicable_hours": hours,
            "matched_courses": [], "min_cgpa": 2.0, "min_applicable_hours": 15, "applicable_hours_eligible": hours_ok}


def historical(cgpa=3.72, cgpa_ok=True, hours=3, completed=3):
    """deterministic_results as agent 1.0.x stored them (no structured keys)."""
    return {"cgpa": cgpa, "cgpa_eligible": cgpa_ok, "completed_hours": completed, "applicable_hours": hours,
            "matched_courses": []}


def test_a_new_run_exposes_the_recorded_checks():
    view = service.eligibility_view(structured(hours=3, hours_ok=False, completed=3), "REJECT")
    assert view == {
        "recorded": True,
        "cgpa": {"value": 3.72, "minimum": 2.0, "passed": True},
        "applicable_hours": {"value": 3, "minimum": 15, "passed": False},
        "completed_hours": 3,
        "recommendation_conflict": False,
    }


def test_a_historical_run_keeps_its_values_and_records_nothing_new():
    # No minimums or applicable-hours result are filled in from the current
    # constants or the agent version; the CGPA result calculated then is kept.
    view = service.eligibility_view(historical(cgpa=1.9, cgpa_ok=False), "REJECT")
    assert view == {
        "recorded": False,
        "cgpa": {"value": 1.9, "minimum": None, "passed": False},
        "applicable_hours": {"value": 3, "minimum": None, "passed": None},
        "completed_hours": 3,
        "recommendation_conflict": False,
    }


@pytest.mark.parametrize("results, recommendation, conflict", [
    (structured(hours=3, hours_ok=False), "APPROVE", True),
    (structured(cgpa=1.5, cgpa_ok=False), "APPROVE", True),
    (structured(cgpa=1.5, cgpa_ok=False, hours=3, hours_ok=False), "APPROVE", True),
    (structured(), "APPROVE", False),
    (structured(hours=3, hours_ok=False), "REJECT", False),
    (structured(hours=3, hours_ok=False), "REQUIRES_REVIEW", False),
    # Historical: the missing applicable-hours result never counts as a failure...
    (historical(hours=3), "APPROVE", False),
    # ...but the CGPA result recorded at the time does.
    (historical(cgpa=1.5, cgpa_ok=False), "APPROVE", True),
])
def test_recommendation_conflict(results, recommendation, conflict):
    assert service.eligibility_view(results, recommendation)["recommendation_conflict"] is conflict


@pytest.mark.parametrize("results", [None, "not an object", []])
def test_no_eligibility_view_without_stored_results(results):
    assert service.eligibility_view(results, None) is None


def test_reading_runs_never_changes_the_stored_records(repo, agent_run):
    fake = repo()
    agent_run(success("APPROVE", historical()))
    service.ensure_evaluation(RID, STAFF, rerun=False)
    agent_run(GeminiUnavailableError("Gemini request failed: ServerError 503"))
    service.ensure_evaluation(RID, STAFF, rerun=True)
    stored = copy.deepcopy(fake.runs)
    locks = list(fake.locks)

    state = service.read_evaluation(RID)

    assert fake.runs == stored and fake.locks == locks
    assert state["current"]["deterministic_results"] == historical()   # returned exactly as stored
    assert state["current"]["eligibility"]["recorded"] is False
    assert state["current"]["recommendation"] == "APPROVE"             # never overridden
    assert state["latest_attempt"]["eligibility"] is None              # failed run: no results


def test_a_rerun_records_structured_results_beside_the_historical_run(repo, agent_run):
    fake = repo()
    agent_run(success("REJECT", historical()))
    service.ensure_evaluation(RID, STAFF, rerun=False)
    agent_run(success("REJECT", structured(hours=3, hours_ok=False)))
    service.ensure_evaluation(RID, STAFF, rerun=True)

    assert fake.runs[0]["deterministic_results"] == historical()        # the older run is untouched
    state = service.read_evaluation(RID)
    assert state["current"]["id"] == 2 and state["current"]["eligibility"]["recorded"] is True


# -- request checks before anything is stored -----------------------------------------------------

def test_unknown_request(repo, agent_run):
    fake = repo()
    calls = agent_run(success())
    with pytest.raises(RequestNotFoundError):
        service.ensure_evaluation("STUD_UNKNOWN", STAFF, rerun=True)
    with pytest.raises(RequestNotFoundError):
        service.read_evaluation("STUD_UNKNOWN")
    assert fake.runs == [] and fake.locks == [] and calls == []


def test_other_request_type(repo, agent_run):
    fake = repo(request_type="Raise Capacity")
    calls = agent_run(success())
    with pytest.raises(NotProgramChangeRequestError):
        service.ensure_evaluation(RID, STAFF, rerun=True)
    assert fake.runs == [] and fake.locks == [] and calls == []


# -- end to end: Shaikha's agent, unchanged, through the service ----------------------------------

def test_end_to_end_with_the_real_agent_and_fake_gemini(repo, monkeypatch):
    fake = repo()
    request = program_change_request(approve_transcript(), request_id=RID)
    monkeypatch.setattr(eligibility_agent, "get_program_change_request", lambda rid: request)
    monkeypatch.setattr(evidence, "get_program_change_request", lambda rid: request)
    models = FakeTextModels([STUDY_PLAN_REPLY, report("APPROVE")])
    monkeypatch.setattr(gemini, "get_client", lambda: type("Client", (), {"models": models})())

    service.ensure_evaluation(RID, STAFF, rerun=False)

    [run] = fake.runs
    assert run["run_status"] == "completed" and run["recommendation"] == "APPROVE"
    assert run["deterministic_results"]["applicable_hours"] == 24
    assert run["deterministic_results"]["cgpa_eligible"] is True
    assert run["deterministic_results"]["applicable_hours_eligible"] is True
    assert service.read_evaluation(RID)["current"]["eligibility"] == {
        "recorded": True,
        "cgpa": {"value": 3.1, "minimum": 2.0, "passed": True},
        "applicable_hours": {"value": 24, "minimum": 15, "passed": True},
        "completed_hours": run["deterministic_results"]["completed_hours"],
        "recommendation_conflict": False,
    }
    assert run["report"] == report("APPROVE").strip()
    assert run["evidence"]["request"] == request
    assert len(run["evidence"]["reference_files"]) == 3
    assert run["study_plan_model"] == run["assessment_model"] == "gemini-3.5-flash-lite"

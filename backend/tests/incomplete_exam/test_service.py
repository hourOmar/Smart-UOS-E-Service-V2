"""Run management for Incomplete Exam evaluations (service.py): first opening only
for In Progress requests with details and without runs, the details-missing
state, reruns, duplicate prevention, interrupted runs, failure classification
(never a recommendation), keeping the last successful result, and never storing
tokens or file contents. An in-memory fake repository stands in for
agents.incomplete_exam_evaluation; the workflow is a fake."""

import inspect
import json
from contextlib import contextmanager
from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError, OperationalError

from app.agents.incomplete_exam import AGENT_VERSION, repository, service, workflow
from app.agents.incomplete_exam.evidence import build_evidence_package
from app.agents.incomplete_exam.exceptions import (
    IncompleteExamDetailsMissingError, InvalidRecommendationError, NotIncompleteExamRequestError,
    ProofFileMissingError, ProofPathError, RequestNotFoundError, RerunNotAllowedError, RunInProgressError,
    StudentNotFoundError,
)
from app.core import storage
from app.core.auth import StaffIdentity, StaffSession
from app.core.database import DatabaseUnavailableError
from app.core.gemini import GeminiUnavailableError

from .fakes import PDF, REQUEST_ID, STUDENT_NAME, TOKEN, request_data

RID = REQUEST_ID
STAFF = StaffIdentity(auth_user_id="00000000-0000-0000-0000-0000000000b1", staff_id=100001)
SESSION = StaffSession(identity=STAFF, access_token=TOKEN)
CHECKS = {"enrollment": "Enrolled.", "submission_window": "On time.", "proof": "Reviewed.",
          "reason_validity": "Valid.", "exam_type": "Midterm."}


class UniqueViolation(Exception):
    sqlstate = "23505"


def _now():
    return datetime.now(timezone.utc)


class FakeRepo:
    """Behaves like the table: one running row per request, finished rows final,
    REJECT exactly with a rejection explanation."""
    MAX_ERROR_LENGTH = repository.MAX_ERROR_LENGTH
    INTERRUPTED_MESSAGE = repository.INTERRUPTED_MESSAGE
    proof_references = staticmethod(repository.proof_references)

    def __init__(self, status="In Progress", request_type="Incomplete Exam", details=True):
        self.requests = {RID: {"request_type": request_type, "current_status": status}}
        self.details = {RID} if details else set()
        self.runs: list[dict] = []
        self.locks: list[str] = []
        self.race_on_start = False
        self.refuse_complete = False

    def read_request(self, conn, rid):
        return self.requests.get(rid)

    def has_details(self, conn, rid):
        return rid in self.details

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
               "recommendation": None, "reasoning": None, "check_explanations": None,
               "deterministic_results": None, "evidence": None, "proof_files": None,
               "rejection_explanation": None, "assessment_model": None, "rejection_model": None,
               "agent_version": version, "failure_kind": None, "error_message": None}
        self.runs.append(run)
        return run["id"]

    def _running(self, run_id):
        run = next(r for r in self.runs if r["id"] == run_id)
        return run if run["run_status"] == "running" else None

    def complete_run(self, conn, run_id, outcome):
        if self.refuse_complete:
            raise IntegrityError("UPDATE", {}, Exception("check constraint"))
        assert (outcome["recommendation"] == "REJECT") == (outcome["rejection_explanation"] is not None)
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
def agents(monkeypatch):
    """Replaces the workflow with one that returns `result` or raises it."""
    def install(result):
        calls = []

        def fake(request_id, access_token):
            calls.append((request_id, access_token))
            if isinstance(result, BaseException):
                raise result
            return result
        monkeypatch.setattr(workflow, "run_incomplete_exam_agents", fake)
        return calls
    return install


def outcome(recommendation="APPROVE", reasoning="Synthetic reasoning.", window_ok=True, rejection_model="rej-model",
            assessment_model="test-model"):
    evidence = build_evidence_package(RID, request_data(), [{"filename": "a.pdf", "mime_type": "application/pdf",
                                                            "data": PDF}])
    evidence["checks"]["submission_window"]["satisfied"] = window_ok
    agent5 = {"request_id": RID, "evidence": evidence, "recommendation": recommendation, "reasoning": reasoning,
              "checks": dict(CHECKS), "gemini_status": "ok", "gemini_error": None}
    if recommendation == "REJECT":
        agent6 = {"request_id": RID, "status": "ok", "gemini_status": "ok", "gemini_error": None,
                  "deterministic_keywords": [], "judgment_keywords": ["proof_inconsistent_or_unverifiable"],
                  "suggested_reasons": [{"tone": "formal", "text": "Your document could not be accepted.",
                                         "addresses_keywords": ["proof_inconsistent_or_unverifiable"]}],
                  "conflict_note": ""}
    else:
        agent6 = {"request_id": RID, "status": "not_applicable", "message": "n/a", "deterministic_keywords": [],
                  "judgment_keywords": [], "suggested_reasons": [], "conflict_note": ""}
    return workflow.WorkflowOutcome(
        agent5=agent5, agent6=agent6, evidence=workflow.evidence_snapshot(evidence),
        proof_files=[{"path": f"{RID}/a.pdf", "outcome": "attached", "mime_type": "application/pdf",
                      "bytes": len(PDF), "sha256": "0" * 64}],
        assessment_model=assessment_model,
        rejection_model=rejection_model if recommendation == "REJECT" else None,
    )


# --- first opening and reruns ---------------------------------------------------

def test_first_open_runs_and_stores_the_outcome(repo, agents):
    fake = repo()
    calls = agents(outcome("APPROVE"))
    result = service.ensure_evaluation(RID, SESSION, rerun=False)
    assert result == service.EnsureOutcome(started=True, in_progress=False, reason="started")
    assert calls == [(RID, TOKEN)] and fake.locks == [RID]
    run = fake.runs[0]
    assert run["run_status"] == "completed" and run["run_trigger"] == "first_open"
    assert run["recommendation"] == "APPROVE" and run["reasoning"] == "Synthetic reasoning."
    assert run["check_explanations"] == CHECKS and run["assessment_model"] == "test-model"
    assert run["rejection_explanation"] is None and run["rejection_model"] is None
    assert run["agent_version"] == AGENT_VERSION
    assert run["triggered_by"] == STAFF.auth_user_id and run["triggered_by_staff_id"] == STAFF.staff_id
    assert run["deterministic_results"]["enrollment"] == {"found": True, "grade": None}
    assert run["deterministic_results"]["proof"]["file_attached"] is True
    assert run["evidence"]["knowledge_files"] and run["proof_files"][0]["path"] == f"{RID}/a.pdf"


def test_reject_stores_the_rejection_explanation(repo, agents):
    fake = repo()
    agents(outcome("REJECT"))
    service.ensure_evaluation(RID, SESSION, rerun=False)
    run = fake.runs[0]
    assert run["recommendation"] == "REJECT" and run["rejection_model"] == "rej-model"
    assert run["rejection_explanation"]["suggested_reasons"][0]["text"] == "Your document could not be accepted."


def test_never_stores_the_token_or_file_contents(repo, agents):
    fake = repo()
    agents(outcome("REJECT"))
    service.ensure_evaluation(RID, SESSION, rerun=False)
    stored = json.dumps(fake.runs, default=str)
    assert TOKEN not in stored and "synthetic proof document" not in stored
    view = json.dumps(service.read_evaluation(RID), default=str)
    assert TOKEN not in view and "synthetic proof document" not in view


def test_first_open_does_nothing_when_already_evaluated(repo, agents):
    fake = repo()
    agents(outcome())
    service.ensure_evaluation(RID, SESSION, rerun=False)
    calls = agents(outcome())
    result = service.ensure_evaluation(RID, SESSION, rerun=False)
    assert result.reason == "already_evaluated" and not result.started and calls == [] and len(fake.runs) == 1


@pytest.mark.parametrize("status", ["Completed", "Rejected"])
def test_finalized_requests_never_run(repo, agents, status):
    fake = repo(status=status)
    calls = agents(outcome())
    assert service.ensure_evaluation(RID, SESSION, rerun=False).reason == "not_in_progress"
    with pytest.raises(RerunNotAllowedError):
        service.ensure_evaluation(RID, SESSION, rerun=True)
    assert calls == [] and fake.runs == []


def test_rerun_adds_a_run_and_keeps_history(repo, agents):
    fake = repo()
    agents(outcome("APPROVE"))
    service.ensure_evaluation(RID, SESSION, rerun=False)
    agents(outcome("REJECT"))
    service.ensure_evaluation(RID, SESSION, rerun=True)
    assert [r["run_trigger"] for r in fake.runs] == ["first_open", "rerun"]
    state = service.read_evaluation(RID)
    assert state["current"]["recommendation"] == "REJECT" and state["run_count"] == 2
    assert state["latest_attempt"] is None and state["can_rerun"] is True and state["auto_run_eligible"] is False


# --- details missing --------------------------------------------------------------

def test_details_missing_never_runs_automatically(repo, agents):
    fake = repo(details=False)
    calls = agents(outcome())
    result = service.ensure_evaluation(RID, SESSION, rerun=False)
    assert result == service.EnsureOutcome(started=False, in_progress=False, reason="details_missing")
    assert calls == [] and fake.runs == []
    state = service.read_evaluation(RID)
    assert state["details_missing"] is True and state["details_missing_message"] == service.DETAILS_MISSING_MESSAGE
    assert state["auto_run_eligible"] is False and state["can_rerun"] is False
    assert state["current"] is None and state["run_count"] == 0


def test_details_missing_rerun_is_refused_without_a_run(repo, agents):
    fake = repo(details=False)
    calls = agents(outcome())
    with pytest.raises(IncompleteExamDetailsMissingError):
        service.ensure_evaluation(RID, SESSION, rerun=True)
    assert calls == [] and fake.runs == []


def test_details_present_state(repo):
    repo()
    state = service.read_evaluation(RID)
    assert state["details_missing"] is False and state["details_missing_message"] is None
    assert state["auto_run_eligible"] is True and state["request_status"] == "In Progress"


def test_details_vanishing_mid_run_is_a_data_failure(repo, agents):
    fake = repo()
    agents(IncompleteExamDetailsMissingError("Request_ID=X is an Incomplete Exam request but has no details."))
    service.ensure_evaluation(RID, SESSION, rerun=False)
    assert fake.runs[0]["failure_kind"] == "data" and fake.runs[0]["recommendation"] is None


# --- request checks ------------------------------------------------------------------

def test_unknown_and_other_requests_are_refused_before_anything_is_stored(repo, agents):
    fake = repo(request_type="Raise Capacity")
    calls = agents(outcome())
    with pytest.raises(NotIncompleteExamRequestError):
        service.ensure_evaluation(RID, SESSION, rerun=False)
    with pytest.raises(RequestNotFoundError):
        service.ensure_evaluation("STUD_INCRQ_INC2_999999", SESSION, rerun=False)
    with pytest.raises(NotIncompleteExamRequestError):
        service.read_evaluation(RID)
    assert calls == [] and fake.runs == [] and fake.locks == []


# --- concurrency and interrupted runs ----------------------------------------------

def test_a_running_run_blocks_first_open_and_rerun(repo, agents):
    fake = repo()
    fake.start_run(None, RID, "first_open", STAFF.auth_user_id, STAFF.staff_id, AGENT_VERSION)
    calls = agents(outcome())
    result = service.ensure_evaluation(RID, SESSION, rerun=False)
    assert result == service.EnsureOutcome(started=False, in_progress=True, reason="running")
    with pytest.raises(RunInProgressError):
        service.ensure_evaluation(RID, SESSION, rerun=True)
    assert calls == []
    assert service.read_evaluation(RID)["can_rerun"] is False


def test_unique_index_race(repo, agents):
    fake = repo()
    fake.race_on_start = True
    calls = agents(outcome())
    assert service.ensure_evaluation(RID, SESSION, rerun=False).reason == "running"
    with pytest.raises(RunInProgressError):
        service.ensure_evaluation(RID, SESSION, rerun=True)
    assert calls == []


def test_interrupted_run_is_expired_before_a_new_one(repo, agents):
    fake = repo()
    fake.start_run(None, RID, "first_open", STAFF.auth_user_id, STAFF.staff_id, AGENT_VERSION)
    fake.runs[0]["_stale"] = True
    state = service.read_evaluation(RID)
    assert state["latest_attempt"]["run_status"] == "interrupted" and state["in_progress"] is False
    assert state["latest_attempt"]["error_message"] == repository.INTERRUPTED_MESSAGE
    agents(outcome())
    service.ensure_evaluation(RID, SESSION, rerun=True)
    assert fake.runs[0]["failure_kind"] == "interrupted" and fake.runs[1]["run_status"] == "completed"


# --- failures: never a recommendation ----------------------------------------------

@pytest.mark.parametrize("error, kind, message", [
    (GeminiUnavailableError("Gemini request failed: ServerError 503 UNAVAILABLE"), "technical",
     "Gemini request failed: ServerError 503 UNAVAILABLE"),
    (InvalidRecommendationError("Gemini returned an unsupported recommendation."), "technical",
     "Gemini returned an unsupported recommendation."),
    (storage.StorageAccessDeniedError("x"), "technical", service.STORAGE_DENIED_MESSAGE),
    (storage.StorageNotConfiguredError("x"), "technical", service.STORAGE_NOT_CONFIGURED_MESSAGE),
    (storage.StorageUnavailableError("x"), "technical", service.STORAGE_UNAVAILABLE_MESSAGE),
    (DatabaseUnavailableError("x"), "technical", "The database could not be reached while collecting evidence."),
    (OperationalError("SELECT", {}, Exception("x")), "technical",
     "The database refused a read while collecting evidence (OperationalError)."),
    (ProofFileMissingError("A proof file listed for this request was not found in Storage."), "data",
     "A proof file listed for this request was not found in Storage."),
    (ProofPathError("A saved proof path is not inside this request's folder."), "data",
     "A saved proof path is not inside this request's folder."),
    (StudentNotFoundError("No Student found for the student of Request_ID='X'."), "data",
     "No Student found for the student of Request_ID='X'."),
])
def test_failures_are_classified_and_never_carry_an_outcome(repo, agents, error, kind, message):
    fake = repo()
    agents(error)
    result = service.ensure_evaluation(RID, SESSION, rerun=False)
    assert result.started is True
    run = fake.runs[0]
    assert run["run_status"] == "failed" and run["failure_kind"] == kind and run["error_message"] == message
    for column in ("recommendation", "reasoning", "check_explanations", "rejection_explanation", "rejection_model"):
        assert run[column] is None
    assert TOKEN not in run["error_message"]


def test_gemini_outage_is_never_manual_review(repo, agents):
    fake = repo()
    agents(GeminiUnavailableError("Gemini request failed on every configured model: m: 503"))
    service.ensure_evaluation(RID, SESSION, rerun=False)
    state = service.read_evaluation(RID)
    assert state["current"] is None
    assert state["latest_attempt"]["failure_kind"] == "technical"
    assert state["latest_attempt"]["recommendation"] is None
    assert "MANUAL_REVIEW" not in json.dumps(fake.runs, default=str)


def test_unexpected_errors_are_technical_and_logged_without_values(repo, agents, caplog):
    fake = repo()
    agents(KeyError(STUDENT_NAME))
    service.ensure_evaluation(RID, SESSION, rerun=False)
    run = fake.runs[0]
    assert run["failure_kind"] == "technical"
    assert run["error_message"] == "Unexpected error during the eligibility check (KeyError)."
    assert STUDENT_NAME not in caplog.text


def test_blank_reasoning_or_missing_model_is_a_technical_failure(repo, agents):
    fake = repo()
    agents(outcome(reasoning="   "))
    service.ensure_evaluation(RID, SESSION, rerun=False)
    agents(outcome(assessment_model=None))
    service.ensure_evaluation(RID, SESSION, rerun=True)
    assert [r["failure_kind"] for r in fake.runs] == ["technical", "technical"]
    assert all(r["recommendation"] is None for r in fake.runs)


def test_a_result_the_table_refuses_is_recorded_as_failed(repo, agents):
    fake = repo()
    fake.refuse_complete = True
    agents(outcome())
    service.ensure_evaluation(RID, SESSION, rerun=False)
    run = fake.runs[0]
    assert run["run_status"] == "failed" and run["error_message"] == service.NOT_STORED_MESSAGE
    assert run["recommendation"] is None


def test_failed_rerun_keeps_the_last_successful_result(repo, agents):
    repo()
    agents(outcome("REJECT"))
    service.ensure_evaluation(RID, SESSION, rerun=False)
    agents(GeminiUnavailableError("Gemini request failed: 503"))
    service.ensure_evaluation(RID, SESSION, rerun=True)
    state = service.read_evaluation(RID)
    assert state["current"]["recommendation"] == "REJECT"
    assert state["latest_attempt"]["run_status"] == "failed" and state["latest_attempt"]["recommendation"] is None


# --- the review view -------------------------------------------------------------------

def test_conflict_flag_for_an_approve_against_a_failed_check(repo, agents):
    repo()
    agents(outcome("APPROVE", window_ok=False))
    service.ensure_evaluation(RID, SESSION, rerun=False)
    current = service.read_evaluation(RID)["current"]
    assert current["recommendation"] == "APPROVE" and current["recommendation_conflict"] is True


def test_no_conflict_for_consistent_results():
    ok = {"submission_window": {"satisfied": True}, "enrollment": {"found": True},
          "proof": {"file_attached": True}, "exam_type": {"excluded": False}}
    assert service.recommendation_conflict("APPROVE", ok) is False
    assert service.recommendation_conflict("REJECT", {**ok, "submission_window": {"satisfied": False}}) is False
    assert service.recommendation_conflict("APPROVE", {**ok, "proof": {"file_attached": False}}) is True
    assert service.recommendation_conflict("APPROVE", None) is False


def test_service_never_changes_requests_or_creates_decisions():
    source = inspect.getsource(service) + inspect.getsource(repository) + inspect.getsource(workflow)
    for forbidden in ('UPDATE public."Request"', '"Decision"', "decide_", 'INSERT INTO public.'):
        assert forbidden not in source

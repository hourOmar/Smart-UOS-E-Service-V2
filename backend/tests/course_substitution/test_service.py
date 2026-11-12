"""Run management for Course Substitution evaluations (service.py): first opening
only for In Progress requests with details and without runs, reruns, duplicate
starts, interrupted runs, failure classification (never a result), keeping the
last successful result, and request-level states. An in-memory fake repository
stands in for agents.course_substitution_evaluation; the workflow is a fake."""

import copy
import datetime as dt
from contextlib import contextmanager
from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError, OperationalError

from app.agents.course_substitution_eligibility import AGENT_VERSION, repository, service, workflow
from app.agents.course_substitution_eligibility.exceptions import (
    CourseNotFoundError, CourseSubstitutionDetailsMissingError, InvalidEligibilityResultError,
    NotCourseSubstitutionRequestError, RequestNotFoundError, RerunNotAllowedError, RunInProgressError,
    StudentNotFoundError,
)
from app.core.auth import StaffIdentity
from app.core.database import DatabaseUnavailableError
from app.core.gemini import GeminiUnavailableError

from .fakes import (
    ETHICS, FAKE_KEY, PROGRAMMING_I, STUDENT_ID, api_error, db_rows, freeze_today, install_fake_database,
    install_fake_gemini,
)

RID = "STUD_CSUB_900001"
STAFF = StaffIdentity(auth_user_id="00000000-0000-0000-0000-0000000000b1", staff_id=100001)
STUDY_PLAN_FAILED = "Could not verify the official study plan with Gemini: GeminiUnavailableError: Gemini request failed: ServerError 503 UNAVAILABLE"


class UniqueViolation(Exception):
    sqlstate = "23505"


class FakeRepo:
    """Behaves like the table: one running row per request, finished rows final."""
    MAX_ERROR_LENGTH = repository.MAX_ERROR_LENGTH
    INTERRUPTED_MESSAGE = repository.INTERRUPTED_MESSAGE

    def __init__(self, status="In Progress", request_type="Course Substitution", details=True):
        self.requests = {RID: {"request_type": request_type, "current_status": status}}
        self.details = {RID: details}
        self.runs: list[dict] = []
        self.locks: list[str] = []
        self.race_on_start = False
        self.refuse_completion = False

    def read_request(self, conn, rid):
        return copy.deepcopy(self.requests.get(rid))

    def has_details(self, conn, rid):
        return self.details.get(rid, False)

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
               "overall_result": None, "current_term": None, "current_semester": None, "checks": None,
               "rejection": None, "evidence": None, "study_plan_model": None, "rejection_model": None,
               "gemini_error": None, "agent_version": version, "failure_kind": None, "error_message": None}
        self.runs.append(run)
        return run["id"]

    def _running(self, run_id):
        run = next(r for r in self.runs if r["id"] == run_id)
        return run if run["run_status"] == "running" else None

    def complete_run(self, conn, run_id, outcome):
        if self.refuse_completion:
            raise OperationalError("UPDATE", {}, Exception("check constraint"))
        repository._json(outcome["evidence"])          # the real serialization must succeed
        run = self._running(run_id)
        if run is None:
            return False
        run.update(run_status="completed", finished_at=_now(), **copy.deepcopy(outcome))
        return True

    def fail_run(self, conn, run_id, kind, message):
        run = self._running(run_id)
        if run is None:
            return False
        run.update(run_status="failed", finished_at=_now(), failure_kind=kind,
                   error_message=message[:self.MAX_ERROR_LENGTH])
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
        monkeypatch.setattr(workflow, "evaluate_course_substitution_request", fake)
        return calls
    return install


def checks(*statuses, study_plan_evidence="Matched catalog program. Listed under compulsory courses."):
    names = ["Original course unavailable before graduation", "Proposed course is at the same level or higher",
             "Original course is a core course", "Proposed course is offered in the current semester",
             "Proposed course has not been completed previously"]
    return [{"condition": name, "status": status,
             "evidence": study_plan_evidence if i == 2 else f"Evidence {i}."}
            for i, (name, status) in enumerate(zip(names, statuses))]


def success(overall="ELIGIBLE", statuses=("PASS",) * 5, rejection=None, term=202601, semester="Fall", **kwargs):
    return workflow.CourseSubstitutionOutcome(
        result={"request_id": RID, "current_term": term, "current_semester": semester,
                "overall_result": overall, "checks": checks(*statuses, **kwargs)},
        rejection=rejection,
        evidence={"request": {"request_id": RID, "request_date": "2026-11-04"}, "knowledge_files": [],
                  "collected_at": "2026-11-12T08:00:00+00:00"},
        study_plan_model="m-plan", rejection_model="m-rej" if rejection else None)


REJECTION = {"status": "fallback", "overall_result": "NOT_ELIGIBLE", "gemini_error": None,
             "deterministic_keywords": [{"keyword": "proposed_course_lower_level"}], "suggested_reasons": []}


# -- first opening and reruns -----------------------------------------------------------------

def test_first_opening_of_an_in_progress_request_runs_and_saves_everything(repo, agent_run):
    fake = repo()
    agent_run(success())
    outcome = service.ensure_evaluation(RID, STAFF, rerun=False)
    assert (outcome.started, outcome.in_progress, outcome.reason) == (True, False, "started")
    [run] = fake.runs
    assert run["run_status"] == "completed" and run["run_trigger"] == "first_open"
    assert (run["overall_result"], run["current_term"], run["current_semester"]) == ("ELIGIBLE", 202601, "Fall")
    assert len(run["checks"]) == 5 and run["rejection"] is None
    assert run["evidence"]["request"]["request_date"] == "2026-11-04"
    assert (run["study_plan_model"], run["rejection_model"], run["gemini_error"]) == ("m-plan", None, None)
    assert run["triggered_by"] == STAFF.auth_user_id and run["triggered_by_staff_id"] == 100001
    assert run["agent_version"] == AGENT_VERSION == "1.0.0"
    assert run["failure_kind"] is None and run["error_message"] is None
    assert fake.locks == [RID]


def test_not_eligible_stores_the_rejection(repo, agent_run):
    fake = repo()
    agent_run(success("NOT_ELIGIBLE", ("PASS", "FAIL", "PASS", "PASS", "PASS"), rejection=REJECTION))
    service.ensure_evaluation(RID, STAFF, rerun=False)
    run = fake.runs[0]
    assert run["overall_result"] == "NOT_ELIGIBLE" and run["rejection"] == REJECTION
    assert run["rejection_model"] == "m-rej"


def test_summer_run_stores_null_term(repo, agent_run):
    fake = repo()
    agent_run(success("MANUAL_REVIEW", ("REQUIRES_REVIEW", "PASS", "PASS", "REQUIRES_REVIEW", "PASS"),
                      term=None, semester=None))
    service.ensure_evaluation(RID, STAFF, rerun=False)
    run = fake.runs[0]
    assert (run["current_term"], run["current_semester"], run["overall_result"]) == (None, None, "MANUAL_REVIEW")


def test_degraded_gemini_calls_are_recorded_in_gemini_error(repo, agent_run):
    fake = repo()
    rejection = {**REJECTION, "gemini_error": "GeminiUnavailableError: Gemini request failed: ClientError 429"}
    agent_run(success("NOT_ELIGIBLE", ("FAIL", "PASS", "REQUIRES_REVIEW", "PASS", "PASS"), rejection=rejection,
                      study_plan_evidence=STUDY_PLAN_FAILED))
    service.ensure_evaluation(RID, STAFF, rerun=False)
    assert fake.runs[0]["gemini_error"] == (
        "Study plan check: GeminiUnavailableError: Gemini request failed: ServerError 503 UNAVAILABLE; "
        "Rejection step: GeminiUnavailableError: Gemini request failed: ClientError 429")
    assert fake.runs[0]["run_status"] == "completed"


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
    agent_run(success())
    service.ensure_evaluation(RID, STAFF, rerun=False)
    agent_run(success("NOT_ELIGIBLE", ("PASS", "FAIL", "PASS", "PASS", "PASS"), rejection=REJECTION))
    outcome = service.ensure_evaluation(RID, STAFF, rerun=True)
    assert outcome.started is True
    assert [r["run_trigger"] for r in fake.runs] == ["first_open", "rerun"]
    assert fake.runs[1]["overall_result"] == "NOT_ELIGIBLE"


@pytest.mark.parametrize("status", ["Completed", "Rejected"])
def test_rerun_of_a_finalized_request_is_refused_under_the_lock(repo, agent_run, status):
    fake = repo(status=status)
    calls = agent_run(success())
    with pytest.raises(RerunNotAllowedError):
        service.ensure_evaluation(RID, STAFF, rerun=True)
    assert fake.runs == [] and calls == [] and fake.locks == [RID]


# -- details missing --------------------------------------------------------------------------

def test_details_missing_never_runs_automatically_and_creates_no_row(repo, agent_run):
    fake = repo(details=False)
    calls = agent_run(success())
    outcome = service.ensure_evaluation(RID, STAFF, rerun=False)
    assert (outcome.started, outcome.reason) == (False, "details_missing")
    assert fake.runs == [] and calls == []
    state = service.read_evaluation(RID)
    assert state["details_missing"] is True and state["details_missing_message"] == service.DETAILS_MISSING_MESSAGE
    assert state["auto_run_eligible"] is False and state["can_rerun"] is False


def test_rerun_without_details_is_refused(repo, agent_run):
    fake = repo(details=False)
    calls = agent_run(success())
    with pytest.raises(CourseSubstitutionDetailsMissingError):
        service.ensure_evaluation(RID, STAFF, rerun=True)
    assert fake.runs == [] and calls == []


# -- request-level states -----------------------------------------------------------------------

def test_unknown_request_is_not_found_before_anything_is_stored(repo, agent_run):
    fake = repo()
    calls = agent_run(success())
    for rerun in (False, True):
        with pytest.raises(RequestNotFoundError):
            service.ensure_evaluation("NO_SUCH_REQUEST", STAFF, rerun=rerun)
    with pytest.raises(RequestNotFoundError):
        service.read_evaluation("NO_SUCH_REQUEST")
    assert fake.runs == [] and fake.locks == [] and calls == []


def test_other_request_type_is_refused_before_anything_is_stored(repo, agent_run):
    fake = repo(request_type="Program Change")
    calls = agent_run(success())
    with pytest.raises(NotCourseSubstitutionRequestError):
        service.ensure_evaluation(RID, STAFF, rerun=False)
    with pytest.raises(NotCourseSubstitutionRequestError):
        service.read_evaluation(RID)
    assert not issubclass(NotCourseSubstitutionRequestError, RequestNotFoundError)
    assert fake.runs == [] and fake.locks == [] and calls == []


# -- one run at a time ------------------------------------------------------------------------

def test_duplicate_start_while_running(repo, agent_run):
    fake = repo()
    fake.runs.append({**_running_row(1), "started_at": _now()})
    calls = agent_run(success())
    outcome = service.ensure_evaluation(RID, STAFF, rerun=False)
    assert (outcome.started, outcome.in_progress, outcome.reason) == (False, True, "running")
    with pytest.raises(RunInProgressError):
        service.ensure_evaluation(RID, STAFF, rerun=True)
    assert len(fake.runs) == 1 and calls == []


def test_unique_index_race_is_a_duplicate_start(repo, agent_run):
    fake = repo()
    fake.race_on_start = True
    calls = agent_run(success())
    outcome = service.ensure_evaluation(RID, STAFF, rerun=False)
    assert (outcome.started, outcome.reason) == (False, "running")
    with pytest.raises(RunInProgressError):
        service.ensure_evaluation(RID, STAFF, rerun=True)
    assert calls == []


def test_other_integrity_errors_are_not_hidden(repo, agent_run):
    fake = repo()

    def broken(*args):
        raise IntegrityError("INSERT", {}, Exception("not null"))
    fake.start_run = broken
    agent_run(success())
    with pytest.raises(IntegrityError):
        service.ensure_evaluation(RID, STAFF, rerun=False)


def _running_row(run_id):
    return {"id": run_id, "request_id": RID, "run_status": "running", "run_trigger": "first_open",
            "triggered_by": STAFF.auth_user_id, "triggered_by_staff_id": 1, "started_at": _now(),
            "finished_at": None, "overall_result": None, "current_term": None, "current_semester": None,
            "checks": None, "rejection": None, "evidence": None, "study_plan_model": None, "rejection_model": None,
            "gemini_error": None, "agent_version": AGENT_VERSION, "failure_kind": None, "error_message": None}


# -- interrupted runs -------------------------------------------------------------------------

def test_interrupted_run_is_shown_then_expired_before_a_new_run(repo, agent_run):
    fake = repo()
    fake.runs.append({**_running_row(1), "_stale": True})
    state = service.read_evaluation(RID)
    assert state["latest_attempt"]["run_status"] == "interrupted"
    assert state["latest_attempt"]["failure_kind"] == "interrupted"
    assert state["latest_attempt"]["error_message"] == repository.INTERRUPTED_MESSAGE
    assert state["in_progress"] is False and state["can_rerun"] is True

    agent_run(success())
    outcome = service.ensure_evaluation(RID, STAFF, rerun=True)
    assert outcome.started is True
    assert fake.runs[0]["run_status"] == "failed" and fake.runs[0]["failure_kind"] == "interrupted"
    assert fake.runs[1]["run_status"] == "completed"


def test_a_result_arriving_after_expiry_is_discarded(repo, monkeypatch):
    fake = repo()

    def expires_meanwhile(request_id):
        fake.runs[0].update(run_status="failed", failure_kind="interrupted", finished_at=_now(),
                            error_message=repository.INTERRUPTED_MESSAGE)
        return success()
    monkeypatch.setattr(workflow, "evaluate_course_substitution_request", expires_meanwhile)
    service.ensure_evaluation(RID, STAFF, rerun=False)
    assert fake.runs[0]["run_status"] == "failed" and fake.runs[0]["overall_result"] is None


# -- failures ---------------------------------------------------------------------------------

@pytest.mark.parametrize("exc, kind", [
    (StudentNotFoundError("No Student found for the student of Request_ID='R'."), "data"),
    (CourseNotFoundError("Original course 1501246 was not found."), "data"),
    (CourseSubstitutionDetailsMissingError("details missing"), "data"),
    (GeminiUnavailableError("GEMINI_API_KEY is not configured."), "technical"),
    (InvalidEligibilityResultError("Missing 'checks'."), "technical"),
    (DatabaseUnavailableError("down"), "technical"),
    (OperationalError("SELECT", {}, Exception("refused")), "technical"),
    (ValueError("bad value"), "technical"),
    (KeyError("student"), "technical"),
])
def test_failures_are_failed_runs_without_a_result(repo, agent_run, exc, kind):
    fake = repo()
    agent_run(exc)
    outcome = service.ensure_evaluation(RID, STAFF, rerun=False)
    assert outcome.started is True
    [run] = fake.runs
    assert run["run_status"] == "failed" and run["failure_kind"] == kind
    assert run["error_message"]
    for column in ("overall_result", "checks", "rejection", "evidence", "current_term", "gemini_error"):
        assert run[column] is None


def test_unexpected_errors_store_only_the_type(repo, agent_run):
    fake = repo()
    agent_run(KeyError(f"{STUDENT_ID} secret detail"))
    service.ensure_evaluation(RID, STAFF, rerun=False)
    assert fake.runs[0]["error_message"] == "Unexpected error during the eligibility check (KeyError)."


def test_stored_error_messages_are_sanitized_and_cut_to_2000(repo, agent_run):
    fake = repo()
    agent_run(StudentNotFoundError(f"student {STUDENT_ID} key={FAKE_KEY} someone@uos.ac.ae"))
    service.ensure_evaluation(RID, STAFF, rerun=False)
    message = fake.runs[0]["error_message"]
    for secret in (STUDENT_ID, FAKE_KEY, "someone@uos.ac.ae"):
        assert secret not in message

    agent_run(GeminiUnavailableError("Gemini request failed on every configured model: " + "m: 503; " * 400))
    service.ensure_evaluation(RID, STAFF, rerun=True)
    assert len(fake.runs[1]["error_message"]) == 2000


@pytest.mark.parametrize("bad", [
    success(overall="MAYBE"),
    workflow.CourseSubstitutionOutcome(result={"overall_result": "ELIGIBLE", "checks": [], "current_term": None,
                                               "current_semester": None}, rejection=None, evidence={}),
])
def test_results_outside_the_contract_are_technical_failures(repo, agent_run, bad):
    fake = repo()
    agent_run(bad)
    service.ensure_evaluation(RID, STAFF, rerun=False)
    assert fake.runs[0]["run_status"] == "failed" and fake.runs[0]["failure_kind"] == "technical"


def test_rejection_is_dropped_unless_not_eligible(repo, agent_run):
    fake = repo()
    agent_run(success("MANUAL_REVIEW", ("PASS", "PASS", "REQUIRES_REVIEW", "PASS", "PASS"), rejection=REJECTION))
    service.ensure_evaluation(RID, STAFF, rerun=False)
    assert fake.runs[0]["rejection"] is None


def test_a_refused_or_unserializable_result_is_a_technical_failure(repo, agent_run):
    fake = repo()
    fake.refuse_completion = True
    agent_run(success())
    service.ensure_evaluation(RID, STAFF, rerun=False)
    assert fake.runs[0]["run_status"] == "failed"
    assert fake.runs[0]["error_message"] == service.NOT_STORED_MESSAGE

    fake.refuse_completion = False
    bad = success()
    bad.evidence["request"]["request_date"] = dt.date(2026, 11, 4)     # not JSON-ready
    agent_run(bad)
    service.ensure_evaluation(RID, STAFF, rerun=True)
    assert fake.runs[1]["run_status"] == "failed"
    assert fake.runs[1]["error_message"] == service.NOT_STORED_MESSAGE


# -- the last good result is kept ----------------------------------------------------------------

def test_failed_rerun_keeps_the_previous_result(repo, agent_run):
    fake = repo()
    agent_run(success())
    service.ensure_evaluation(RID, STAFF, rerun=False)
    agent_run(GeminiUnavailableError("Gemini request failed: ServerError 503"))
    service.ensure_evaluation(RID, STAFF, rerun=True)

    state = service.read_evaluation(RID)
    assert state["current"]["id"] == 1 and state["current"]["overall_result"] == "ELIGIBLE"
    assert state["latest_attempt"]["id"] == 2 and state["latest_attempt"]["run_status"] == "failed"
    assert state["latest_attempt"]["overall_result"] is None
    assert state["run_count"] == 2 and state["can_rerun"] is True
    assert fake.runs[0]["run_status"] == "completed"          # never changed


def test_successful_rerun_becomes_current(repo, agent_run):
    repo()
    agent_run(success())
    service.ensure_evaluation(RID, STAFF, rerun=False)
    agent_run(success("NOT_ELIGIBLE", ("PASS", "FAIL", "PASS", "PASS", "PASS"), rejection=REJECTION))
    service.ensure_evaluation(RID, STAFF, rerun=True)
    state = service.read_evaluation(RID)
    assert state["current"]["id"] == 2 and state["current"]["rejection"] == REJECTION
    assert state["latest_attempt"] is None


def test_read_state_of_a_new_request(repo):
    repo()
    state = service.read_evaluation(RID)
    assert state == {"request_id": RID, "request_status": "In Progress", "details_missing": False,
                     "details_missing_message": None, "current": None, "latest_attempt": None,
                     "in_progress": False, "run_count": 0, "auto_run_eligible": True, "can_rerun": True}


# -- end to end with the real workflow ----------------------------------------------------------

def test_real_workflow_example_c_through_the_service(repo, monkeypatch):
    """The real agent (fake database and Gemini) through the service: the stored
    run is JSON-ready and carries the rejection and the degraded Gemini calls."""
    fake = repo()
    freeze_today(monkeypatch, dt.date(2027, 2, 10))
    install_fake_database(monkeypatch, db_rows(original=ETHICS, proposed=PROGRAMMING_I, graduation=202701,
                                               completed=[PROGRAMMING_I[0]]))
    install_fake_gemini(monkeypatch, api_error(503), api_error(503))
    service.ensure_evaluation(RID, STAFF, rerun=False)
    run = fake.runs[0]
    assert run["run_status"] == "completed" and run["overall_result"] == "NOT_ELIGIBLE"
    assert (run["current_term"], run["current_semester"]) == (202602, "Spring")
    assert run["rejection"]["status"] == "fallback"
    assert run["evidence"]["request"]["request_date"] == "2026-11-04"
    assert run["evidence"]["request"]["submission_time"] == "10:30:00"
    assert run["gemini_error"].startswith("Study plan check: GeminiUnavailableError")
    assert "; Rejection step: GeminiUnavailableError" in run["gemini_error"]
    assert (run["study_plan_model"], run["rejection_model"]) == (None, None)


def test_real_workflow_without_a_gemini_key_is_a_technical_failure(repo, monkeypatch):
    fake = repo()
    install_fake_database(monkeypatch, db_rows())
    install_fake_gemini(monkeypatch, key="")
    service.ensure_evaluation(RID, STAFF, rerun=False)
    run = fake.runs[0]
    assert (run["run_status"], run["failure_kind"]) == ("failed", "technical")
    assert run["error_message"] == "GEMINI_API_KEY is not configured."
    assert run["overall_result"] is None

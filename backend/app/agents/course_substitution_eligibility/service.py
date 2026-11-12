"""Evaluation behaviour for Course Substitution requests (same pattern as
program_change_eligibility/service.py and incomplete_exam/service.py).

- First opening (rerun=False): runs the agent only if NO previous run exists
  for the request, the request is In Progress AND its Course_Substitution
  details exist; otherwise nothing runs and the saved state is returned.
- Details missing: a Course Substitution request without a Course_Substitution
  row is shown as `details_missing`; it is never evaluated automatically, and a
  rerun is refused (CourseSubstitutionDetailsMissingError). No run row is created.
- Explicit rerun (rerun=True): only while the request is In Progress and has
  details; otherwise RerunNotAllowedError / CourseSubstitutionDetailsMissingError.
  A finalized request keeps the evaluations it had.
- All three rules are checked under the request's lock, on values read inside
  that same transaction, so they are enforced here, not by the frontend.
- One run at a time per request across all backend processes: the decision to
  start is made under a Postgres advisory lock, and a unique index allows only
  one 'running' row per request.
- Interrupted runs ('running' past the timeout) are marked failed
  (failure_kind 'interrupted') before a new run starts, and shown as
  interrupted until then.
- Every failure is a failed run with failure_kind 'data' or 'technical' and a
  sanitized message (at most 2,000 characters); it never carries a result. A
  missing GEMINI_API_KEY is a technical failure, never a MANUAL_REVIEW. Only a
  completed run carries ELIGIBLE, NOT_ELIGIBLE or MANUAL_REVIEW, exactly as the
  agent returned it, and -- for NOT_ELIGIBLE only -- the rejection result.
- A failed rerun never replaces the last successful result: `current` is the
  newest completed run, and a newer failed/unfinished attempt is reported
  separately as `latest_attempt`.
The result is advisory; nothing here changes a request.
"""

import logging
import traceback
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.auth import StaffIdentity
from app.core.database import DatabaseUnavailableError, is_unique_violation, read_only, write_transaction
from app.core.gemini import GeminiUnavailableError, sanitize

from . import AGENT_VERSION
from . import repository as repo
from . import workflow
from .exceptions import (
    CourseNotFoundError, CourseSubstitutionDetailsMissingError, EmptyRequestIdError, InvalidEligibilityResultError,
    NotCourseSubstitutionRequestError, RequestNotFoundError, RerunNotAllowedError, RunInProgressError,
    StudentNotFoundError,
)

log = logging.getLogger(__name__)

COURSE_SUBSTITUTION = "Course Substitution"
AUTO_RUN_STATUS = "In Progress"
OVERALL_RESULTS = ("ELIGIBLE", "NOT_ELIGIBLE", "MANUAL_REVIEW")

DETAILS_MISSING_MESSAGE = (
    "This request has no Course Substitution details (original course, proposed course and reason), "
    "so it cannot be evaluated."
)
NOT_STORED_MESSAGE = "The evaluation finished but its result could not be stored."

# Check 3's evidence when its Gemini call failed (study_plan_check.py).
_STUDY_PLAN_FAILURE = "Could not verify the official study plan with Gemini: "

# Failures about the request's own records (the evaluation cannot run on them).
_DATA_ERRORS = (StudentNotFoundError, CourseNotFoundError, EmptyRequestIdError,
                CourseSubstitutionDetailsMissingError, RequestNotFoundError, NotCourseSubstitutionRequestError)


@dataclass
class EnsureOutcome:
    started: bool       # this call ran the agent
    in_progress: bool   # another call is running it right now
    reason: str         # started | running | already_evaluated | not_in_progress | details_missing


def _request_state(conn, request_id: str) -> dict:
    record = repo.read_request(conn, request_id)
    if record is None:
        raise RequestNotFoundError(f"No Request found for Request_ID={request_id}.")
    if record["request_type"] != COURSE_SUBSTITUTION:
        raise NotCourseSubstitutionRequestError(
            f"Request_ID={request_id} has Request_Type={record['request_type']!r}, expected 'Course Substitution'."
        )
    return {**record, "has_details": repo.has_details(conn, request_id)}


def check_request(request_id: str) -> dict:
    """{request_type, current_status, has_details}. Raises RequestNotFoundError /
    NotCourseSubstitutionRequestError before anything is stored."""
    with read_only() as conn:
        return _request_state(conn, request_id)


def _claim_run(request_id: str, staff: StaffIdentity, rerun: bool) -> tuple[int | None, str]:
    """(new run id, 'started'), or (None, why nothing should run now)."""
    try:
        with write_transaction() as conn:
            repo.lock_request(conn, request_id)
            repo.expire_interrupted_runs(conn, request_id)
            if repo.has_running_run(conn, request_id):
                if rerun:
                    raise RunInProgressError("An eligibility check is already running for this request.")
                return None, "running"
            state = _request_state(conn, request_id)
            in_progress = state["current_status"] == AUTO_RUN_STATUS
            if rerun:
                if not in_progress:
                    raise RerunNotAllowedError("Only In Progress requests can be evaluated again.")
                if not state["has_details"]:
                    raise CourseSubstitutionDetailsMissingError(DETAILS_MISSING_MESSAGE)
            else:
                if repo.has_any_run(conn, request_id):
                    return None, "already_evaluated"
                if not in_progress:
                    return None, "not_in_progress"
                if not state["has_details"]:
                    return None, "details_missing"
            run_id = repo.start_run(
                conn, request_id, "rerun" if rerun else "first_open", staff.auth_user_id, staff.staff_id,
                AGENT_VERSION,
            )
            return run_id, "started"
    except IntegrityError as exc:
        # Another process claimed it between our check and insert (cannot happen while
        # every caller takes the lock, but the unique index makes it safe regardless).
        if is_unique_violation(exc):
            if rerun:
                raise RunInProgressError("An eligibility check is already running for this request.") from exc
            return None, "running"
        raise


def _safe(message: str) -> str:
    return message[:repo.MAX_ERROR_LENGTH]


def classify_failure(exc: Exception, run_id: int, request_id: str) -> tuple[str, str]:
    """(failure_kind, message safe to store and show to staff). Never includes
    student data or a raw traceback."""
    if isinstance(exc, _DATA_ERRORS):
        return "data", _safe(sanitize(str(exc)) or type(exc).__name__)
    if isinstance(exc, GeminiUnavailableError):
        return "technical", _safe(str(exc))   # already sanitized by app.core.gemini
    if isinstance(exc, InvalidEligibilityResultError):
        return "technical", _safe(sanitize(str(exc)) or type(exc).__name__)
    if isinstance(exc, DatabaseUnavailableError):
        return "technical", "The database could not be reached while collecting evidence."
    if isinstance(exc, SQLAlchemyError):
        return "technical", f"The database refused a read while collecting evidence ({type(exc).__name__})."
    if isinstance(exc, ValueError):
        return "technical", _safe(sanitize(str(exc)) or type(exc).__name__)
    # Type and code locations only: the message or a full traceback of an
    # unexpected error (e.g. a KeyError) could carry evidence values.
    frames = traceback.extract_tb(exc.__traceback__)[-4:]
    where = " <- ".join(f"{Path(f.filename).name}:{f.lineno} {f.name}" for f in reversed(frames))
    log.error("Course Substitution run %s for %s failed unexpectedly: %s at %s", run_id, request_id,
              type(exc).__name__, where)
    return "technical", f"Unexpected error during the eligibility check ({type(exc).__name__})."


def gemini_errors(result: dict, rejection: dict | None) -> str | None:
    """The Gemini failures a completed run worked around (check 3 became
    REQUIRES_REVIEW; the rejection step used its template fallback). Both
    texts are already sanitized by the agent."""
    parts = []
    for check in result["checks"]:
        evidence = check.get("evidence")
        if isinstance(evidence, str) and evidence.startswith(_STUDY_PLAN_FAILURE):
            parts.append("Study plan check: " + evidence[len(_STUDY_PLAN_FAILURE):])
    if rejection is not None and rejection.get("gemini_error"):
        parts.append("Rejection step: " + rejection["gemini_error"])
    return _safe("; ".join(parts)) if parts else None


def completed_outcome(outcome: workflow.CourseSubstitutionOutcome) -> dict:
    """The stored columns of a completed run; refuses a result outside the contract."""
    result = outcome.result
    if result.get("overall_result") not in OVERALL_RESULTS:
        raise InvalidEligibilityResultError(f"Invalid overall result: {result.get('overall_result')!r}.")
    if not isinstance(result.get("checks"), list) or len(result["checks"]) != 5:
        raise InvalidEligibilityResultError("The eligibility result must contain exactly five checks.")
    rejection = outcome.rejection if result["overall_result"] == "NOT_ELIGIBLE" else None
    return {
        "overall_result": result["overall_result"],
        "current_term": result["current_term"],
        "current_semester": result["current_semester"],
        "checks": result["checks"],
        "rejection": rejection,
        "evidence": outcome.evidence,
        "study_plan_model": outcome.study_plan_model,
        "rejection_model": outcome.rejection_model,
        "gemini_error": gemini_errors(result, rejection),
    }


def _finish_completed(run_id: int, stored: dict) -> None:
    with write_transaction() as conn:
        done = repo.complete_run(conn, run_id, stored)
    if not done:
        log.warning("Course Substitution run %s was no longer running when it finished; result discarded.", run_id)


def _finish_failed(run_id: int, failure_kind: str, message: str) -> None:
    with write_transaction() as conn:
        done = repo.fail_run(conn, run_id, failure_kind, message)
    if not done:
        log.warning("Course Substitution run %s was no longer running when it failed.", run_id)


def _fail(run_id: int, request_id: str, exc: Exception) -> None:
    failure_kind, message = classify_failure(exc, run_id, request_id)
    log.warning("Course Substitution run %s for %s failed (%s): %s", run_id, request_id, failure_kind, message)
    _finish_failed(run_id, failure_kind, message)


def ensure_evaluation(request_id: str, staff: StaffIdentity, rerun: bool) -> EnsureOutcome:
    """Runs the agent when the rules above allow it."""
    check_request(request_id)
    run_id, reason = _claim_run(request_id, staff, rerun)
    if run_id is None:
        return EnsureOutcome(started=False, in_progress=_is_running(request_id), reason=reason)

    try:
        outcome = workflow.evaluate_course_substitution_request(request_id)
        stored = completed_outcome(outcome)
    except Exception as exc:  # noqa: BLE001 - recorded as a failed run, never left 'running'
        _fail(run_id, request_id, exc)
        return EnsureOutcome(started=True, in_progress=False, reason="started")

    try:
        _finish_completed(run_id, stored)
    except (SQLAlchemyError, TypeError, ValueError) as exc:
        # The result was refused by the table, could not be serialized, or the
        # write failed: never left running.
        log.warning("Course Substitution run %s for %s could not be stored (%s)", run_id, request_id,
                    type(exc).__name__)
        _finish_failed(run_id, "technical", NOT_STORED_MESSAGE)
    return EnsureOutcome(started=True, in_progress=False, reason="started")


def _is_running(request_id: str) -> bool:
    with read_only() as conn:
        return repo.has_running_run(conn, request_id)


def summarize_runs(runs: list[dict]) -> dict:
    """`current`: newest completed run. `latest_attempt`: the newest run when it is
    not `current` (a failed, interrupted or running attempt)."""
    current = next((r for r in runs if r["run_status"] == "completed"), None)
    newest = runs[0] if runs else None
    latest_attempt = newest if newest is not None and (current is None or newest["id"] != current["id"]) else None
    return {
        "current": current,
        "latest_attempt": latest_attempt,
        "in_progress": any(r["run_status"] == "running" and not r["interrupted"] for r in runs),
        "run_count": len(runs),
    }


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


def run_view(run: dict | None) -> dict | None:
    if run is None:
        return None
    interrupted = bool(run.get("interrupted"))
    return {
        "id": run["id"],
        "run_status": "interrupted" if interrupted else run["run_status"],
        "trigger": run["run_trigger"],
        "started_at": _iso(run["started_at"]),
        "finished_at": _iso(run["finished_at"]),
        "overall_result": run["overall_result"],
        "current_term": run["current_term"],
        "current_semester": run["current_semester"],
        "checks": run["checks"],
        "rejection": run["rejection"],
        "evidence": run["evidence"],
        "study_plan_model": run["study_plan_model"],
        "rejection_model": run["rejection_model"],
        "gemini_error": run["gemini_error"],
        "agent_version": run["agent_version"],
        "failure_kind": "interrupted" if interrupted else run["failure_kind"],
        "error_message": repo.INTERRUPTED_MESSAGE if interrupted else run["error_message"],
    }


def read_evaluation(request_id: str) -> dict:
    """The saved evaluation state of one request; never runs the agent."""
    with read_only() as conn:
        state = _request_state(conn, request_id)
        runs = repo.list_runs(conn, request_id)
    summary = summarize_runs(runs)
    in_progress_request = state["current_status"] == AUTO_RUN_STATUS
    details = state["has_details"]
    return {
        "request_id": request_id,
        "request_status": state["current_status"],
        "details_missing": not details,
        "details_missing_message": None if details else DETAILS_MISSING_MESSAGE,
        "current": run_view(summary["current"]),
        "latest_attempt": run_view(summary["latest_attempt"]),
        "in_progress": summary["in_progress"],
        "run_count": summary["run_count"],
        "auto_run_eligible": summary["run_count"] == 0 and in_progress_request and details,
        "can_rerun": in_progress_request and details and not summary["in_progress"],
    }

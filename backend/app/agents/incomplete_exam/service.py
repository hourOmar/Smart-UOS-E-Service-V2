"""Evaluation behaviour for Incomplete Exam requests (same pattern as
program_change_eligibility/service.py).

- First opening (rerun=False): runs the agents only if NO previous run exists
  for the request, the request is In Progress AND its Incomplete_Exam details
  exist; otherwise nothing runs and the saved state is returned.
- Details missing: an Incomplete Exam request without an Incomplete_Exam row is
  shown as `details_missing`; it is never evaluated automatically, and a rerun
  is refused (IncompleteExamDetailsMissingError). No run row is created.
- Explicit rerun (rerun=True): only while the request is In Progress and has
  details; otherwise RerunNotAllowedError / IncompleteExamDetailsMissingError.
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
  sanitized message (at most 2,000 characters); it never carries a
  recommendation -- a Gemini outage is never stored as MANUAL_REVIEW. Only a
  completed run carries APPROVE, REJECT or MANUAL_REVIEW, exactly as Agent 5
  returned it, and -- after a REJECT only -- Agent 6's rejection explanation.
- A failed rerun never replaces the last successful result: `current` is the
  newest completed run, and a newer failed/unfinished attempt is reported
  separately as `latest_attempt`.
- The staff member's access token is passed to the workflow for the proof
  downloads only; it is never stored, logged or returned.
The recommendation is advisory: nothing here changes a request or creates a
decision.
"""

import logging
import traceback
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core import storage
from app.core.auth import StaffIdentity, StaffSession
from app.core.database import DatabaseUnavailableError, is_unique_violation, read_only, write_transaction
from app.core.gemini import GeminiUnavailableError, sanitize

from . import AGENT_VERSION
from . import repository as repo
from . import workflow
from .exceptions import (
    IncompleteExamDetailsMissingError, InvalidAgent5ResultError, InvalidRecommendationError,
    NotIncompleteExamRequestError, ProofDataError, RequestNotFoundError, RerunNotAllowedError,
    RunInProgressError, StudentNotFoundError,
)

log = logging.getLogger(__name__)

INCOMPLETE_EXAM = "Incomplete Exam"
AUTO_RUN_STATUS = "In Progress"

DETAILS_MISSING_MESSAGE = (
    "This request has no Incomplete Exam details (course, section, term, missed exam and proof), "
    "so it cannot be evaluated."
)
STORAGE_DENIED_MESSAGE = (
    "Supabase Storage refused the staff session while downloading the proof documents. Sign in again and retry."
)
STORAGE_NOT_CONFIGURED_MESSAGE = "Supabase Storage is not configured on the backend."
STORAGE_UNAVAILABLE_MESSAGE = "Supabase Storage could not be reached while downloading the proof documents."
NOT_STORED_MESSAGE = "The evaluation finished but its result could not be stored."

# Failures about the request's own records (the evaluation cannot run on them).
_DATA_ERRORS = (ProofDataError, StudentNotFoundError, IncompleteExamDetailsMissingError,
                RequestNotFoundError, NotIncompleteExamRequestError)


@dataclass
class EnsureOutcome:
    started: bool       # this call ran the agents
    in_progress: bool   # another call is running them right now
    reason: str         # started | running | already_evaluated | not_in_progress | details_missing


def _request_state(conn, request_id: str) -> dict:
    record = repo.read_request(conn, request_id)
    if record is None:
        raise RequestNotFoundError(f"No Request found for Request_ID={request_id}.")
    if record["request_type"] != INCOMPLETE_EXAM:
        raise NotIncompleteExamRequestError(
            f"Request_ID={request_id} has Request_Type={record['request_type']!r}, expected 'Incomplete Exam'."
        )
    return {**record, "has_details": repo.has_details(conn, request_id)}


def check_request(request_id: str) -> dict:
    """{request_type, current_status, has_details}. Raises RequestNotFoundError /
    NotIncompleteExamRequestError before anything is stored."""
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
                    raise IncompleteExamDetailsMissingError(DETAILS_MISSING_MESSAGE)
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
    """(failure_kind, message safe to store and show to staff). Never includes a
    token, file contents or a raw traceback."""
    if isinstance(exc, _DATA_ERRORS):
        return "data", _safe(sanitize(str(exc)) or type(exc).__name__)
    if isinstance(exc, GeminiUnavailableError):
        return "technical", _safe(str(exc))   # already sanitized by app.core.gemini
    if isinstance(exc, (InvalidRecommendationError, InvalidAgent5ResultError)):
        return "technical", _safe(sanitize(str(exc)))
    if isinstance(exc, storage.StorageAccessDeniedError):
        return "technical", STORAGE_DENIED_MESSAGE
    if isinstance(exc, storage.StorageNotConfiguredError):
        return "technical", STORAGE_NOT_CONFIGURED_MESSAGE
    if isinstance(exc, storage.StorageError):
        return "technical", STORAGE_UNAVAILABLE_MESSAGE
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
    log.error("Incomplete Exam run %s for %s failed unexpectedly: %s at %s", run_id, request_id,
              type(exc).__name__, where)
    return "technical", f"Unexpected error during the eligibility check ({type(exc).__name__})."


def deterministic_results(evidence: dict) -> dict:
    """The verified (non-Gemini) checks of the evidence, for the review page."""
    checks = evidence["checks"]
    enrollment = checks["enrollment"]
    proof = checks["proof"]
    return {
        "enrollment": {"found": enrollment["found"], "grade": (enrollment.get("record") or {}).get("Grade")},
        "submission_window": checks["submission_window"],
        "proof": {key: proof.get(key) for key in ("required", "provided", "file_attached", "file_count", "file_source")},
        "exam_type": checks["exam_type"],
    }


def completed_outcome(outcome: workflow.WorkflowOutcome) -> dict:
    """What a completed run stores. The rejection explanation (and its model)
    only after a REJECT. Raises ValueError for a reply that cannot be stored."""
    agent5 = outcome.agent5
    recommendation = agent5["recommendation"]
    if not isinstance(agent5.get("reasoning"), str) or not agent5["reasoning"].strip():
        raise ValueError("Gemini returned an empty reasoning for the eligibility check.")
    if not outcome.assessment_model:
        raise ValueError("The model that answered the eligibility check was not recorded.")
    rejection = outcome.agent6 if recommendation == "REJECT" else None
    return {
        "recommendation": recommendation,
        "reasoning": agent5["reasoning"],
        "check_explanations": agent5["checks"],
        "deterministic_results": deterministic_results(agent5["evidence"]),
        "evidence": outcome.evidence,
        "proof_files": repo.proof_references(outcome.proof_files),
        "rejection_explanation": rejection,
        "assessment_model": outcome.assessment_model,
        "rejection_model": outcome.rejection_model if rejection is not None else None,
    }


def _finish_completed(run_id: int, stored: dict) -> bool:
    with write_transaction() as conn:
        done = repo.complete_run(conn, run_id, stored)
    if not done:
        log.warning("Incomplete Exam run %s was no longer running when it finished; result discarded.", run_id)
    return done


def _finish_failed(run_id: int, failure_kind: str, message: str) -> None:
    with write_transaction() as conn:
        stored = repo.fail_run(conn, run_id, failure_kind, message)
    if not stored:
        log.warning("Incomplete Exam run %s was no longer running when it failed.", run_id)


def _fail(run_id: int, request_id: str, exc: Exception) -> None:
    failure_kind, message = classify_failure(exc, run_id, request_id)
    log.warning("Incomplete Exam run %s for %s failed (%s): %s", run_id, request_id, failure_kind, message)
    _finish_failed(run_id, failure_kind, message)


def ensure_evaluation(request_id: str, session: StaffSession, rerun: bool) -> EnsureOutcome:
    """Runs the agents when the rules above allow it. `session` is the verified
    staff session; its token is used only for this run's proof downloads."""
    check_request(request_id)
    run_id, reason = _claim_run(request_id, session.identity, rerun)
    if run_id is None:
        return EnsureOutcome(started=False, in_progress=_is_running(request_id), reason=reason)

    try:
        outcome = workflow.run_incomplete_exam_agents(request_id, session.access_token)
        stored = completed_outcome(outcome)
    except Exception as exc:  # noqa: BLE001 - recorded as a failed run, never left 'running'
        _fail(run_id, request_id, exc)
        return EnsureOutcome(started=True, in_progress=False, reason="started")

    try:
        _finish_completed(run_id, stored)
    except SQLAlchemyError as exc:
        # The result was refused by the table (or the write failed): never left running.
        log.warning("Incomplete Exam run %s for %s could not be stored (%s)", run_id, request_id, type(exc).__name__)
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


def recommendation_conflict(recommendation: str | None, results: dict | None) -> bool:
    """APPROVE although a verified check failed (window missed, no enrolment,
    no document attached, or an excluded exam type). The stored recommendation
    is never changed; staff see the conflict."""
    if recommendation != "APPROVE" or not isinstance(results, dict):
        return False
    return ((results.get("submission_window") or {}).get("satisfied") is False
            or (results.get("enrollment") or {}).get("found") is False
            or (results.get("proof") or {}).get("file_attached") is False
            or (results.get("exam_type") or {}).get("excluded") is True)


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
        "recommendation": run["recommendation"],
        "reasoning": run["reasoning"],
        "check_explanations": run["check_explanations"],
        "deterministic_results": run["deterministic_results"],
        "recommendation_conflict": recommendation_conflict(run["recommendation"], run["deterministic_results"]),
        "evidence": run["evidence"],
        "proof_files": run["proof_files"],
        "rejection_explanation": run["rejection_explanation"],
        "assessment_model": run["assessment_model"],
        "rejection_model": run["rejection_model"],
        "agent_version": run["agent_version"],
        "failure_kind": "interrupted" if interrupted else run["failure_kind"],
        "error_message": repo.INTERRUPTED_MESSAGE if interrupted else run["error_message"],
    }


def read_evaluation(request_id: str) -> dict:
    """The saved evaluation state of one request; never runs the agents."""
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

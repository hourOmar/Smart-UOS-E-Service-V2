"""Evaluation behaviour for Program Change requests (same pattern as
raise_capacity_eligibility/service.py).

- First opening (rerun=False): runs the agent only if NO previous run exists for
  the request AND the request is In Progress; otherwise nothing runs and the
  saved state is returned.
- Explicit rerun (rerun=True): only while the request is In Progress; otherwise
  RerunNotAllowedError. A finalized request keeps the evaluations it had.
- Both status rules are checked under the request's lock, on the status read
  inside that same transaction, so they are enforced here, not by the frontend.
- One run at a time per request across all backend processes: the decision to
  start is made under a Postgres advisory lock, and a unique index allows only
  one 'running' row per request.
- Interrupted runs ('running' past the timeout) are marked failed
  (failure_kind 'interrupted') before a new run starts, and shown as
  interrupted until then.
- Every failure is a failed run with failure_kind 'data' or 'technical' and a
  sanitized message (at most 2,000 characters); it never carries a
  recommendation. Only a completed run carries APPROVE, REJECT or
  REQUIRES_REVIEW, exactly as the agent returned it.
- A failed rerun never replaces the last successful result: `current` is the
  newest completed run, and a newer failed/unfinished attempt is reported
  separately as `latest_attempt`.
The recommendation is advisory; nothing here changes a request.
"""

import logging
import traceback
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.auth import StaffIdentity
from app.core.database import DatabaseUnavailableError, is_unique_violation, read_only, write_transaction
from app.core.gemini import GeminiUnavailableError, describe_failure, sanitize

from . import AGENT_VERSION
from . import repository as repo
from . import workflow
from .exceptions import (
    NotProgramChangeRequestError, RequestNotFoundError, RerunNotAllowedError, RunInProgressError,
)

log = logging.getLogger(__name__)

PROGRAM_CHANGE = "Program Change"
AUTO_RUN_STATUS = "In Progress"

# The request has no Program_Change row, or a program whose ID and name do not
# both match the Program table (the agent's read returns nothing).
NOT_FOUND_MESSAGE = (
    "The Program Change details of this request could not be read: no Program_Change "
    "record, or a current or requested program whose ID and name do not both match "
    "the Program table."
)
MISSING_GRADE_MESSAGE = (
    "A course in the transcript has no grade yet (for example, still in progress). "
    "The eligibility checks only accept the grades A to F."
)

# ValueErrors the agent raises about the request's own academic data. Every other
# ValueError it raises concerns Gemini's output (unusable study plan or report).
_DATA_ERRORS = (
    "Expected exactly one catalog entry",
    "Unknown grade:",
    "CGPA is missing",
    "No Program Change request found",
    "is not a Program Change request",
)


@dataclass
class EnsureOutcome:
    started: bool       # this call ran the agent
    in_progress: bool   # another call is running it right now
    reason: str         # started | running | already_evaluated | not_in_progress


def check_request(request_id: str) -> dict:
    """Raises RequestNotFoundError / NotProgramChangeRequestError before anything is
    stored for an unknown or non-Program-Change request."""
    with read_only() as conn:
        record = repo.read_request(conn, request_id)
    if record is None:
        raise RequestNotFoundError(f"No Request found for Request_ID={request_id}.")
    if record["request_type"] != PROGRAM_CHANGE:
        raise NotProgramChangeRequestError(
            f"Request_ID={request_id} has Request_Type={record['request_type']!r}, expected 'Program Change'."
        )
    return record


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
            record = repo.read_request(conn, request_id)
            in_progress = record is not None and record["current_status"] == AUTO_RUN_STATUS
            if rerun:
                if not in_progress:
                    raise RerunNotAllowedError("Only In Progress requests can be evaluated again.")
            else:
                if repo.has_any_run(conn, request_id):
                    return None, "already_evaluated"
                if not in_progress:
                    return None, "not_in_progress"
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


def _raised_by(exc: BaseException, function_name: str) -> bool:
    return any(frame.name == function_name for frame in traceback.extract_tb(exc.__traceback__))


def classify_failure(exc: Exception, run_id: int, request_id: str) -> tuple[str, str]:
    """(failure_kind, message safe to store and show to staff)."""
    if isinstance(exc, GeminiUnavailableError):
        return "technical", _safe(str(exc))   # already sanitized by app.core.gemini
    if isinstance(exc, DatabaseUnavailableError):
        return "technical", "The database could not be reached while collecting evidence."
    if isinstance(exc, SQLAlchemyError):
        return "technical", f"The database refused a read while collecting evidence ({type(exc).__name__})."
    if isinstance(exc, ValueError):
        message = _safe(sanitize(str(exc)) or type(exc).__name__)
        return ("data" if any(marker in str(exc) for marker in _DATA_ERRORS) else "technical"), message
    if isinstance(exc, AttributeError) and _raised_by(exc, "is_completed_grade"):
        return "data", MISSING_GRADE_MESSAGE
    # Code locations only: a full traceback could carry evidence values.
    frames = traceback.extract_tb(exc.__traceback__)[-4:]
    where = " <- ".join(f"{Path(f.filename).name}:{f.lineno} {f.name}" for f in reversed(frames))
    log.error("Program Change run %s for %s failed unexpectedly: %s at %s", run_id, request_id, describe_failure(exc), where)
    return "technical", f"Unexpected error during the eligibility check ({type(exc).__name__})."


def _finish_completed(run_id: int, outcome: workflow.WorkflowOutcome) -> None:
    with write_transaction() as conn:
        stored = repo.complete_run(conn, run_id, {
            "recommendation": outcome.result["agent_recommendation"],
            "report": outcome.result["report"],
            "deterministic_results": outcome.result["deterministic_results"],
            "evidence": outcome.evidence,
            "study_plan_model": outcome.study_plan_model,
            "assessment_model": outcome.assessment_model,
        })
    if not stored:
        log.warning("Program Change run %s was no longer running when it finished; result discarded.", run_id)


def _finish_failed(run_id: int, failure_kind: str, message: str) -> None:
    with write_transaction() as conn:
        stored = repo.fail_run(conn, run_id, failure_kind, message)
    if not stored:
        log.warning("Program Change run %s was no longer running when it failed.", run_id)


def ensure_evaluation(request_id: str, staff: StaffIdentity, rerun: bool) -> EnsureOutcome:
    check_request(request_id)
    run_id, reason = _claim_run(request_id, staff, rerun)
    if run_id is None:
        return EnsureOutcome(started=False, in_progress=_is_running(request_id), reason=reason)

    try:
        outcome = workflow.evaluate_program_change_request(request_id)
    except Exception as exc:  # noqa: BLE001 - recorded as a failed run, never left 'running'
        failure_kind, message = classify_failure(exc, run_id, request_id)
        log.warning("Program Change run %s for %s failed (%s): %s", run_id, request_id, failure_kind, message)
        _finish_failed(run_id, failure_kind, message)
    else:
        if outcome.found:
            _finish_completed(run_id, outcome)
        else:
            _finish_failed(run_id, "data", NOT_FOUND_MESSAGE)
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


# Keys that runs from agent 1.1.0 onward store in deterministic_results.
_STRUCTURED_KEYS = ("min_cgpa", "min_applicable_hours", "applicable_hours_eligible")


def eligibility_view(results: dict | None, recommendation: str | None) -> dict | None:
    """The academic checks exactly as stored with the run; nothing is recomputed.

    Runs evaluated before the structured results existed (`recorded`: False) have
    no minimums and no applicable-hours result: those stay None, never filled in
    from the current constants. `recommendation_conflict`: an APPROVE while a
    recorded check failed (a check with no recorded result never counts). The
    stored recommendation is never changed."""
    if not isinstance(results, dict):
        return None
    cgpa_passed = results.get("cgpa_eligible")
    hours_passed = results.get("applicable_hours_eligible")
    return {
        "recorded": all(key in results for key in _STRUCTURED_KEYS),
        "cgpa": {"value": results.get("cgpa"), "minimum": results.get("min_cgpa"), "passed": cgpa_passed},
        "applicable_hours": {
            "value": results.get("applicable_hours"),
            "minimum": results.get("min_applicable_hours"),
            "passed": hours_passed,
        },
        "completed_hours": results.get("completed_hours"),
        "recommendation_conflict": recommendation == "APPROVE" and (cgpa_passed is False or hours_passed is False),
    }


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
        "report": run["report"],
        "deterministic_results": run["deterministic_results"],
        "eligibility": eligibility_view(run["deterministic_results"], run["recommendation"]),
        "evidence": run["evidence"],
        "study_plan_model": run["study_plan_model"],
        "assessment_model": run["assessment_model"],
        "agent_version": run["agent_version"],
        "failure_kind": "interrupted" if interrupted else run["failure_kind"],
        "error_message": repo.INTERRUPTED_MESSAGE if interrupted else run["error_message"],
    }


def read_evaluation(request_id: str) -> dict:
    """The saved evaluation state of one request; never runs the agent."""
    record = check_request(request_id)
    with read_only() as conn:
        runs = repo.list_runs(conn, request_id)
    summary = summarize_runs(runs)
    return {
        "request_id": request_id,
        "request_status": record["current_status"],
        "current": run_view(summary["current"]),
        "latest_attempt": run_view(summary["latest_attempt"]),
        "in_progress": summary["in_progress"],
        "run_count": summary["run_count"],
        "auto_run_eligible": summary["run_count"] == 0 and record["current_status"] == AUTO_RUN_STATUS,
        "can_rerun": record["current_status"] == AUTO_RUN_STATUS and not summary["in_progress"],
    }

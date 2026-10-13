"""Evaluation behaviour for the staff review page.

- First opening (rerun=False): runs the agent only if NO previous run exists for the
  request. Later openings return the saved result without rerunning.
- Explicit rerun (rerun=True): allowed for every recommendation.
- One run at a time per request across all backend processes: the decision to start
  is made under a Postgres advisory lock, and a unique index allows only one
  'running' row per request.
- Interrupted runs ('running' past the timeout) are marked failed before a new run
  starts, and shown as interrupted until then.
- A failed rerun never replaces the last successful result: `current` is the newest
  successful run, and a newer failed/unfinished attempt is reported separately.
"""

import logging
import traceback
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.exc import IntegrityError

from app.core.auth import StaffIdentity
from app.core.database import DatabaseUnavailableError, is_unique_violation, read_only, write_transaction
from app.core.gemini import describe_failure

from . import AGENT_VERSION
from . import repository as repo
from .exceptions import AgentError
from .tools.request import get_raise_capacity_request
from .workflow import evaluate_raise_capacity_request

log = logging.getLogger(__name__)


class RunInProgressError(Exception):
    """A rerun was requested while another run for the request is still running."""


@dataclass
class EnsureOutcome:
    started: bool       # this call ran the agent
    in_progress: bool   # another call is running it right now


def check_request(request_id: str) -> dict:
    """Raises RequestNotFoundError / NotRaiseCapacityRequestError before anything is
    stored for an unknown or non-Raise-Capacity request."""
    with read_only() as conn:
        return get_raise_capacity_request(conn, request_id)


def _claim_run(request_id: str, staff: StaffIdentity, rerun: bool) -> int | None:
    """Returns the new run's id, or None when nothing should run now."""
    try:
        with write_transaction() as conn:
            repo.lock_request(conn, request_id)
            repo.expire_interrupted_runs(conn, request_id)
            if repo.has_running_run(conn, request_id):
                if rerun:
                    raise RunInProgressError("An eligibility check is already running for this request.")
                return None
            if not rerun and repo.has_any_run(conn, request_id):
                return None
            return repo.start_run(
                conn, request_id, "rerun" if rerun else "first_open", staff.auth_user_id, staff.staff_id,
                AGENT_VERSION,
            )
    except IntegrityError as exc:
        # Another process claimed it between our check and insert (cannot happen while
        # every caller takes the lock, but the unique index makes it safe regardless).
        if is_unique_violation(exc):
            if rerun:
                raise RunInProgressError("An eligibility check is already running for this request.") from exc
            return None
        raise


def _finish(run_id: int, result: dict | None, error: str | None) -> None:
    with write_transaction() as conn:
        if result is not None:
            stored = repo.complete_run(conn, run_id, result)
        else:
            stored = repo.fail_run(conn, run_id, error or "The eligibility check failed.")
    if not stored:
        log.warning("Run %s was no longer running when it finished; result discarded.", run_id)


def ensure_evaluation(request_id: str, staff: StaffIdentity, rerun: bool) -> EnsureOutcome:
    check_request(request_id)
    run_id = _claim_run(request_id, staff, rerun)
    if run_id is None:
        return EnsureOutcome(started=False, in_progress=_is_running(request_id))

    result, error = None, None
    try:
        result = evaluate_raise_capacity_request(request_id)
    except AgentError as exc:
        error = str(exc)
    except DatabaseUnavailableError:
        error = "The database could not be reached while collecting evidence."
    except Exception as exc:  # noqa: BLE001 - recorded as a failed run, never left 'running'
        # Sanitized message and code locations only: a full traceback could
        # carry data values from the evidence.
        frames = traceback.extract_tb(exc.__traceback__)[-4:]
        where = " <- ".join(f"{Path(f.filename).name}:{f.lineno} {f.name}" for f in reversed(frames))
        log.error("Eligibility run %s for %s failed unexpectedly: %s at %s", run_id, request_id, describe_failure(exc), where)
        error = f"Unexpected error during the eligibility check ({type(exc).__name__})."
    _finish(run_id, result, error)
    return EnsureOutcome(started=True, in_progress=False)


def _is_running(request_id: str) -> bool:
    with read_only() as conn:
        return repo.has_running_run(conn, request_id)


def summarize_runs(runs: list[dict]) -> dict:
    """`current`: newest completed run with a Gemini decision, else the newest
    completed run. `latest_attempt`: the newest run when it is not `current`
    (a failed, interrupted, running or Gemini-unavailable attempt)."""
    completed = [r for r in runs if r["run_status"] == "completed"]
    current = next((r for r in completed if r["gemini_status"] == "ok"), None) or (completed[0] if completed else None)
    newest = runs[0] if runs else None
    latest_attempt = newest if newest is not None and (current is None or newest["id"] != current["id"]) else None
    return {
        "current": current,
        "latest_attempt": latest_attempt,
        "in_progress": any(r["run_status"] == "running" and not r["interrupted"] for r in runs),
        "run_count": len(runs),
    }

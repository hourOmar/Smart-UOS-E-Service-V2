"""Evaluation behaviour for Course Equivalency requests (same pattern as
incomplete_exam/service.py).

- First opening (rerun=False): runs the agents only if NO previous run exists, the request is
  In Progress, its Course_Equivalency details exist AND both syllabi are registered and
  present (Phase 3A readiness); otherwise nothing runs and the saved state is returned.
- Missing syllabi: shown as `syllabi_missing`; never evaluated, no run row, no Gemini call.
- Explicit rerun (rerun=True): only while In Progress with details and both syllabi;
  otherwise RerunNotAllowedError / CourseEquivalencyDetailsMissingError / SyllabiMissingError.
- All rules are checked under the request's advisory lock, on values read in that same
  transaction; one run at a time per request (lock + unique index).
- Interrupted runs ('running' past the timeout) are marked failed (interrupted).
- Every failure is a failed run (failure_kind data / technical, sanitized message); a Gemini
  outage is never stored as MANUAL_REVIEW. A failed rerun never replaces the last
  successful result: `current` is the newest completed run, `latest_attempt` a newer
  failed / running one.
- Outdated results: each run stores the Syllabus_IDs it evaluated; when a side's current
  version differs, the result is reported `outdated` (with the sides) and a rerun is
  offered. Nothing re-runs automatically.
- Legacy syllabi: when BOTH current syllabi are legacy imports (registry Source
  'legacy_import', from the earlier upload system), the saved state reports
  `auto_run_eligible: false` with `manual_start_reason: "legacy_syllabi"`, so the review page
  never starts that first evaluation by itself; `first_run_eligible` stays true and staff
  start it explicitly (POST rerun=false, with every rule above unchanged).
- The staff token is used for the two downloads only; never stored, logged or returned.
The recommendation is advisory: nothing here changes a request or creates a decision.
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
    CourseEquivalencyDetailsMissingError, CourseNotFoundError, KnowledgeBaseError, NotCourseEquivalencyRequestError,
    RequestNotFoundError, RerunNotAllowedError, RunInProgressError, StudentNotFoundError, SyllabiMissingError,
    SyllabusDataError,
)
from .policy import load_equivalency_policy

log = logging.getLogger(__name__)

COURSE_EQUIVALENCY = "Course Equivalency"
AUTO_RUN_STATUS = "In Progress"
RECOMMENDATIONS = ("APPROVE", "REJECT", "MANUAL_REVIEW")

DETAILS_MISSING_MESSAGE = "This request has no Course Equivalency details (old and new course), so it cannot be evaluated."
SYLLABI_MISSING_MESSAGE = (
    "Both syllabi are required: upload the syllabus of the previously completed course and of the "
    "requested course before the eligibility check can run. If both were uploaded, one of the files is "
    "missing or changed in Storage; upload it again."
)
STORAGE_DENIED_MESSAGE = "Supabase Storage refused the staff session while downloading the syllabi. Sign in again and retry."
STORAGE_NOT_CONFIGURED_MESSAGE = "Supabase Storage is not configured on the backend."
STORAGE_UNAVAILABLE_MESSAGE = "Supabase Storage could not be reached while downloading the syllabi."
NOT_STORED_MESSAGE = "The evaluation finished but its result could not be stored."

_DATA_ERRORS = (SyllabusDataError, SyllabiMissingError, StudentNotFoundError, CourseNotFoundError,
                CourseEquivalencyDetailsMissingError, RequestNotFoundError, NotCourseEquivalencyRequestError)


LEGACY_IMPORT = "legacy_import"
MANUAL_START_LEGACY = "legacy_syllabi"


def legacy_syllabi_only(sources: dict) -> bool:
    """Both current syllabi are legacy imports (registry metadata, not request IDs)."""
    return sources.get("old") == LEGACY_IMPORT and sources.get("new") == LEGACY_IMPORT


@dataclass
class EnsureOutcome:
    started: bool
    in_progress: bool
    reason: str   # started | running | already_evaluated | not_in_progress | details_missing | syllabi_missing


def _request_state(conn, request_id: str) -> dict:
    record = repo.read_request(conn, request_id)
    if record is None:
        raise RequestNotFoundError(f"No Request found for Request_ID={request_id}.")
    if record["request_type"] != COURSE_EQUIVALENCY:
        raise NotCourseEquivalencyRequestError(f"Request_ID={request_id} is not a Course Equivalency request.")
    return {**record, "has_details": repo.has_details(conn, request_id),
            "syllabi_ready": repo.syllabi_ready(conn, request_id)}


def check_request(request_id: str) -> dict:
    with read_only() as conn:
        return _request_state(conn, request_id)


def _claim_run(request_id: str, staff: StaffIdentity, rerun: bool) -> tuple[int | None, str]:
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
                    raise CourseEquivalencyDetailsMissingError(DETAILS_MISSING_MESSAGE)
                if not state["syllabi_ready"]:
                    raise SyllabiMissingError(SYLLABI_MISSING_MESSAGE)
            else:
                if repo.has_any_run(conn, request_id):
                    return None, "already_evaluated"
                if not in_progress:
                    return None, "not_in_progress"
                if not state["has_details"]:
                    return None, "details_missing"
                if not state["syllabi_ready"]:
                    return None, "syllabi_missing"
            run_id = repo.start_run(conn, request_id, "rerun" if rerun else "first_open", staff.auth_user_id,
                                    staff.staff_id, AGENT_VERSION)
            return run_id, "started"
    except IntegrityError as exc:
        if is_unique_violation(exc):
            if rerun:
                raise RunInProgressError("An eligibility check is already running for this request.") from exc
            return None, "running"
        raise


def _safe(message: str) -> str:
    return message[:repo.MAX_ERROR_LENGTH]


def classify_failure(exc: Exception, run_id: int, request_id: str) -> tuple[str, str]:
    """(failure_kind, message safe to store and show). Never a token, file content or traceback."""
    if isinstance(exc, _DATA_ERRORS):
        return "data", _safe(sanitize(str(exc)) or type(exc).__name__)
    if isinstance(exc, GeminiUnavailableError):
        return "technical", _safe(str(exc))   # already sanitized by app.core.gemini
    if isinstance(exc, KnowledgeBaseError):
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
    frames = traceback.extract_tb(exc.__traceback__)[-4:]
    where = " <- ".join(f"{Path(f.filename).name}:{f.lineno} {f.name}" for f in reversed(frames))
    log.error("Course Equivalency run %s for %s failed unexpectedly: %s at %s", run_id, request_id,
              type(exc).__name__, where)
    return "technical", f"Unexpected error during the eligibility check ({type(exc).__name__})."


def deterministic_results(evidence: dict) -> dict:
    """The code-verified results (no Gemini judgement), for the review page."""
    old = evidence["old_course"]
    return {
        "constraints": evidence["constraints"],
        "academic_level": evidence["academic_level"],
        "old_course": {k: old.get(k) for k in ("course_id", "name", "credit_hours", "in_catalog", "in_transcript",
                                               "grade", "grade_source", "passed", "term")},
        "new_course": {k: evidence["new_course"].get(k) for k in ("course_id", "name", "credit_hours", "in_catalog")},
        "syllabi": evidence["syllabi"],
        "syllabus_request": evidence["syllabus_request"],
        "similarity": workflow.stored_similarity(evidence["similarity"]),
        "text_overlap_percent": evidence["text_overlap_percent"],
    }


def completed_outcome(outcome: workflow.WorkflowOutcome) -> dict:
    """What a completed run stores. Raises ValueError for a result that cannot be stored."""
    result = outcome.eligibility
    recommendation = result["recommendation"]
    if recommendation not in RECOMMENDATIONS:
        raise ValueError("The eligibility agent returned an unsupported recommendation.")
    if not isinstance(result.get("reasoning"), str) or not result["reasoning"].strip():
        raise ValueError("Gemini returned an empty reasoning for the eligibility check.")
    if not isinstance(result.get("checks"), list):
        raise ValueError("The eligibility check explanations are not a list.")
    if not outcome.assessment_model:
        raise ValueError("The model that answered the eligibility check was not recorded.")
    rejection = outcome.rejection if recommendation == "REJECT" else None
    return {
        "recommendation": recommendation,
        "reasoning": result["reasoning"],
        "check_explanations": result["checks"],
        "deterministic_results": deterministic_results(result["evidence"]),
        "evidence": outcome.evidence,
        "evaluated_syllabi": repo.syllabus_references(outcome.evaluated_syllabi),
        "rejection_explanation": rejection,
        "assessment_model": outcome.assessment_model,
        "rejection_model": outcome.rejection_model if rejection is not None else None,
    }


def _finish_completed(run_id: int, stored: dict) -> bool:
    with write_transaction() as conn:
        done = repo.complete_run(conn, run_id, stored)
    if not done:
        log.warning("Course Equivalency run %s was no longer running when it finished; result discarded.", run_id)
    return done


def _finish_failed(run_id: int, failure_kind: str, message: str) -> None:
    with write_transaction() as conn:
        stored = repo.fail_run(conn, run_id, failure_kind, message)
    if not stored:
        log.warning("Course Equivalency run %s was no longer running when it failed.", run_id)


def _fail(run_id: int, request_id: str, exc: Exception) -> None:
    failure_kind, message = classify_failure(exc, run_id, request_id)
    log.warning("Course Equivalency run %s for %s failed (%s): %s", run_id, request_id, failure_kind, message)
    _finish_failed(run_id, failure_kind, message)


def ensure_evaluation(request_id: str, session: StaffSession, rerun: bool) -> EnsureOutcome:
    """Runs the agents when the rules above allow it. `session` is the verified staff
    session; its token is used only for this run's syllabus downloads."""
    check_request(request_id)
    run_id, reason = _claim_run(request_id, session.identity, rerun)
    if run_id is None:
        return EnsureOutcome(started=False, in_progress=_is_running(request_id), reason=reason)
    try:
        outcome = workflow.run_course_equivalency_agents(request_id, session.access_token)
        stored = completed_outcome(outcome)
    except Exception as exc:  # noqa: BLE001 - recorded as a failed run, never left 'running'
        _fail(run_id, request_id, exc)
        return EnsureOutcome(started=True, in_progress=False, reason="started")
    try:
        _finish_completed(run_id, stored)
    except SQLAlchemyError as exc:
        log.warning("Course Equivalency run %s for %s could not be stored (%s)", run_id, request_id, type(exc).__name__)
        _finish_failed(run_id, "technical", NOT_STORED_MESSAGE)
    return EnsureOutcome(started=True, in_progress=False, reason="started")


def _is_running(request_id: str) -> bool:
    with read_only() as conn:
        return repo.has_running_run(conn, request_id)


def summarize_runs(runs: list[dict]) -> dict:
    current = next((r for r in runs if r["run_status"] == "completed"), None)
    newest = runs[0] if runs else None
    latest_attempt = newest if newest is not None and (current is None or newest["id"] != current["id"]) else None
    return {
        "current": current,
        "latest_attempt": latest_attempt,
        "in_progress": any(r["run_status"] == "running" and not r["interrupted"] for r in runs),
        "run_count": len(runs),
    }


def outdated_sides(evaluated: list[dict] | None, current: dict) -> list[str]:
    """Sides whose current Syllabus_ID differs from the one the run evaluated."""
    if not evaluated:
        return []
    used = {ref.get("side"): ref.get("syllabus_id") for ref in evaluated if isinstance(ref, dict)}
    return [side for side in ("old", "new") if used.get(side) != current.get(side)]


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


def run_view(run: dict | None, current_syllabi: dict) -> dict | None:
    if run is None:
        return None
    interrupted = bool(run.get("interrupted"))
    sides = outdated_sides(run["evaluated_syllabi"], current_syllabi)
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
        "evidence": run["evidence"],
        "evaluated_syllabi": run["evaluated_syllabi"],
        "outdated": bool(sides),
        "outdated_sides": sides,
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
        current_syllabi = repo.current_syllabi(conn, request_id)
        sources = repo.current_syllabus_sources(conn, request_id)
    summary = summarize_runs(runs)
    in_progress_request = state["current_status"] == AUTO_RUN_STATUS
    details, ready = state["has_details"], state["syllabi_ready"]
    first_run_eligible = summary["run_count"] == 0 and in_progress_request and details and ready
    manual_start_reason = MANUAL_START_LEGACY if legacy_syllabi_only(sources) else None
    return {
        "request_id": request_id,
        "request_status": state["current_status"],
        "details_missing": not details,
        "details_missing_message": None if details else DETAILS_MISSING_MESSAGE,
        "syllabi_ready": ready,
        "syllabi_missing_message": None if ready else SYLLABI_MISSING_MESSAGE,
        "current_syllabi": current_syllabi,
        "policy_status": load_equivalency_policy().get("status"),
        "current": run_view(summary["current"], current_syllabi),
        "latest_attempt": run_view(summary["latest_attempt"], current_syllabi),
        "in_progress": summary["in_progress"],
        "run_count": summary["run_count"],
        "current_syllabus_sources": sources,
        # A first evaluation may be started (manually, or automatically when auto_run_eligible).
        "first_run_eligible": first_run_eligible,
        # The review page starts the first evaluation by itself only when this is true.
        "auto_run_eligible": first_run_eligible and manual_start_reason is None,
        "manual_start_reason": manual_start_reason,
        "can_rerun": in_progress_request and details and ready and not summary["in_progress"],
    }

"""Staff-only API for Program Change eligibility evaluations.

Every route depends on require_staff, which verifies the Supabase session and the
Authorized_Staff link BEFORE any request data is read or the agent runs.
The recommendation is advisory; nothing here approves, rejects or changes a
request -- the decision stays with staff.

GET  .../evaluation          the saved state only; never runs the agent
POST .../evaluations {rerun}  rerun=false: first evaluation (only when never
                              evaluated and In Progress); rerun=true: evaluate
                              again (only while In Progress)
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel, ConfigDict, StrictBool
from sqlalchemy.exc import SQLAlchemyError

from app.agents.program_change_eligibility.exceptions import (
    NotProgramChangeRequestError, RequestNotFoundError, RerunNotAllowedError, RunInProgressError,
)
from app.agents.program_change_eligibility.service import ensure_evaluation, read_evaluation
from app.core.auth import StaffIdentity, require_staff

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/staff/program-change", tags=["program-change-review"])

RequestId = Path(min_length=1, max_length=64)

# Shown to staff instead of the stored technical detail (kept in the database).
_TECHNICAL_MESSAGES = {
    "study_plan": "The official study-plan page Gemini read did not match the requested program. Try again later.",
    "gemini": "The AI service (Gemini) was unavailable or returned an unusable reply. Try again later.",
    "database": "The database could not be reached during the check. Try again shortly.",
    "other": "A technical problem stopped the eligibility check. Try again later.",
}


class EvaluationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rerun: StrictBool = False


def _staff_message(failure_kind: str | None, stored: str | None) -> str | None:
    """Data and interrupted failures are explained as stored (sanitized, about the
    request itself); technical ones get a short message without internal detail."""
    if failure_kind != "technical":
        return stored
    text = stored or ""
    if text.startswith("Program mismatch"):
        return _TECHNICAL_MESSAGES["study_plan"]
    if "Gemini" in text:
        return _TECHNICAL_MESSAGES["gemini"]
    if "database" in text.lower():
        return _TECHNICAL_MESSAGES["database"]
    return _TECHNICAL_MESSAGES["other"]


def _for_staff(run: dict | None) -> dict | None:
    if run is None:
        return None
    return {**run, "error_message": _staff_message(run["failure_kind"], run["error_message"])}


def _response(state: dict) -> dict:
    return {"evaluation": {**state, "current": _for_staff(state["current"]),
                           "latest_attempt": _for_staff(state["latest_attempt"])}}


def _not_found(exc: Exception) -> HTTPException:
    if isinstance(exc, NotProgramChangeRequestError):
        return HTTPException(status.HTTP_404_NOT_FOUND, "This is not a Program Change request.")
    return HTTPException(status.HTTP_404_NOT_FOUND, "Request not found.")


def _unavailable(exc: SQLAlchemyError) -> HTTPException:
    log.warning("Program Change evaluation data could not be read or written (%s)", type(exc).__name__)
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Evaluations could not be loaded. Try again shortly.")


@router.get("/{request_id}/evaluation")
def get_evaluation(request_id: str = RequestId, _staff: StaffIdentity = Depends(require_staff)) -> dict:
    """The saved state only; never runs the agent."""
    try:
        return _response(read_evaluation(request_id))
    except (RequestNotFoundError, NotProgramChangeRequestError) as exc:
        raise _not_found(exc) from exc
    except SQLAlchemyError as exc:
        raise _unavailable(exc) from exc


@router.post("/{request_id}/evaluations")
def run_evaluation(
    body: EvaluationRequest,
    request_id: str = RequestId,
    staff: StaffIdentity = Depends(require_staff),
) -> dict:
    """rerun=false: run only if never evaluated and In Progress (otherwise the saved
    state is returned). rerun=true: run again now, only while In Progress
    (409 if another run is in progress or the request is no longer In Progress)."""
    try:
        outcome = ensure_evaluation(request_id, staff, rerun=body.rerun)
        state = read_evaluation(request_id)
    except (RequestNotFoundError, NotProgramChangeRequestError) as exc:
        raise _not_found(exc) from exc
    except RunInProgressError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "An eligibility check is already running for this request.") from exc
    except RerunNotAllowedError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Only In Progress requests can be evaluated again; the saved evaluations are kept.",
        ) from exc
    except SQLAlchemyError as exc:
        raise _unavailable(exc) from exc
    response = _response(state)
    response["evaluation"]["started_by_this_call"] = outcome.started
    response["evaluation"]["outcome"] = outcome.reason
    return response

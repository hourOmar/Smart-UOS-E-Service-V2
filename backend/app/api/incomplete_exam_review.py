"""Staff-only API for Incomplete Exam evaluations (Agent 5, and Agent 6 after a
REJECT).

Every route verifies the Supabase session and the Authorized_Staff link
(require_staff / require_staff_session) BEFORE any request data is read or the
agents run. The recommendation and suggested rejection reasons are advisory;
nothing here approves, rejects or changes a request -- the decision stays with
staff.

GET  .../evaluation           the saved state only; never runs the agents
POST .../evaluations {rerun}  rerun=false: first evaluation (only when never
                              evaluated, In Progress and the Incomplete Exam
                              details exist); rerun=true: evaluate again (only
                              while In Progress and the details exist)

POST needs the caller's own session token: the agents download the student's
proof documents from Supabase Storage AS that staff member (staff read
policy). The token lives only for this request; it is never stored, logged or
returned.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel, ConfigDict, StrictBool
from sqlalchemy.exc import SQLAlchemyError

from app.agents.incomplete_exam import service as evaluation_service
from app.agents.incomplete_exam.exceptions import (
    IncompleteExamDetailsMissingError, NotIncompleteExamRequestError, RequestNotFoundError, RerunNotAllowedError,
    RunInProgressError,
)
from app.agents.incomplete_exam.service import ensure_evaluation, read_evaluation
from app.core.auth import StaffIdentity, StaffSession, require_staff, require_staff_session

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/staff/incomplete-exam", tags=["incomplete-exam-review"])

RequestId = Path(min_length=1, max_length=64)

# Shown to staff instead of the stored technical detail (kept in the database).
_TECHNICAL_MESSAGES = {
    "gemini": "The AI service (Gemini) was unavailable or returned an unusable reply. Try again later.",
    "database": "The database could not be reached during the check. Try again shortly.",
    "other": "A technical problem stopped the eligibility check. Try again later.",
}
# Fixed, already safe and actionable: shown exactly as stored.
_SHOWN_AS_STORED = frozenset({
    evaluation_service.STORAGE_DENIED_MESSAGE,
    evaluation_service.STORAGE_NOT_CONFIGURED_MESSAGE,
    evaluation_service.STORAGE_UNAVAILABLE_MESSAGE,
    evaluation_service.NOT_STORED_MESSAGE,
})


class EvaluationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rerun: StrictBool = False


def _staff_message(failure_kind: str | None, stored: str | None) -> str | None:
    """Data and interrupted failures are explained as stored (sanitized, about the
    request itself); technical ones get a short message without internal detail."""
    if failure_kind != "technical":
        return stored
    text = stored or ""
    if text in _SHOWN_AS_STORED:
        return text
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
    if isinstance(exc, NotIncompleteExamRequestError):
        return HTTPException(status.HTTP_404_NOT_FOUND, "This is not an Incomplete Exam request.")
    return HTTPException(status.HTTP_404_NOT_FOUND, "Request not found.")


def _unavailable(exc: SQLAlchemyError) -> HTTPException:
    log.warning("Incomplete Exam evaluation data could not be read or written (%s)", type(exc).__name__)
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Evaluations could not be loaded. Try again shortly.")


@router.get("/{request_id}/evaluation")
def get_evaluation(request_id: str = RequestId, _staff: StaffIdentity = Depends(require_staff)) -> dict:
    """The saved state only; never runs the agents."""
    try:
        return _response(read_evaluation(request_id))
    except (RequestNotFoundError, NotIncompleteExamRequestError) as exc:
        raise _not_found(exc) from exc
    except SQLAlchemyError as exc:
        raise _unavailable(exc) from exc


@router.post("/{request_id}/evaluations")
def run_evaluation(
    body: EvaluationRequest,
    request_id: str = RequestId,
    session: StaffSession = Depends(require_staff_session),
) -> dict:
    """rerun=false: run only if never evaluated, In Progress and the details exist
    (otherwise the saved state is returned, with `outcome` saying why).
    rerun=true: run again now, only while In Progress and the details exist
    (409 if another run is in progress, the request is no longer In Progress, or
    its Incomplete Exam details are missing)."""
    try:
        outcome = ensure_evaluation(request_id, session, rerun=body.rerun)
        state = read_evaluation(request_id)
    except (RequestNotFoundError, NotIncompleteExamRequestError) as exc:
        raise _not_found(exc) from exc
    except RunInProgressError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "An eligibility check is already running for this request.") from exc
    except RerunNotAllowedError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Only In Progress requests can be evaluated again; the saved evaluations are kept.",
        ) from exc
    except IncompleteExamDetailsMissingError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, evaluation_service.DETAILS_MISSING_MESSAGE) from exc
    except SQLAlchemyError as exc:
        raise _unavailable(exc) from exc
    response = _response(state)
    response["evaluation"]["started_by_this_call"] = outcome.started
    response["evaluation"]["outcome"] = outcome.reason
    return response

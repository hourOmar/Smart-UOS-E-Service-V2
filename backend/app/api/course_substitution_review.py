"""Staff-only API for Course Substitution eligibility evaluations.

Every route depends on require_staff, which verifies the Supabase session and the
Authorized_Staff link BEFORE any request data is read or the agent runs.
The result is advisory; nothing here approves, rejects or changes a request --
the decision stays with staff.

GET  .../evaluation          the saved state only; never runs the agent
POST .../evaluations {rerun}  rerun=false: first evaluation (only when never
                              evaluated, In Progress and the Course Substitution
                              details exist); rerun=true: evaluate again (only
                              while In Progress and the details exist)
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel, ConfigDict, StrictBool
from sqlalchemy.exc import SQLAlchemyError

from app.agents.course_substitution_eligibility import service as evaluation_service
from app.agents.course_substitution_eligibility.exceptions import (
    CourseSubstitutionDetailsMissingError, NotCourseSubstitutionRequestError, RequestNotFoundError,
    RerunNotAllowedError, RunInProgressError,
)
from app.agents.course_substitution_eligibility.service import ensure_evaluation, read_evaluation
from app.core.auth import StaffIdentity, require_staff

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/staff/course-substitution", tags=["course-substitution-review"])

RequestId = Path(min_length=1, max_length=64)

# Shown to staff instead of the stored technical detail (kept in the database).
_TECHNICAL_MESSAGES = {
    "gemini_key": "The AI service (Gemini) is not configured on the backend. Contact the system administrator.",
    "gemini": "The AI service (Gemini) was unavailable or returned an unusable reply. Try again later.",
    "database": "The database could not be reached during the check. Try again shortly.",
    "other": "A technical problem stopped the eligibility check. Try again later.",
}
# Fixed, already safe and actionable: shown exactly as stored.
_SHOWN_AS_STORED = frozenset({evaluation_service.NOT_STORED_MESSAGE})


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
    if "GEMINI_API_KEY" in text:
        return _TECHNICAL_MESSAGES["gemini_key"]
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
    if isinstance(exc, NotCourseSubstitutionRequestError):
        return HTTPException(status.HTTP_404_NOT_FOUND, "This is not a Course Substitution request.")
    return HTTPException(status.HTTP_404_NOT_FOUND, "Request not found.")


def _unavailable(exc: SQLAlchemyError) -> HTTPException:
    log.warning("Course Substitution evaluation data could not be read or written (%s)", type(exc).__name__)
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Evaluations could not be loaded. Try again shortly.")


@router.get("/{request_id}/evaluation")
def get_evaluation(request_id: str = RequestId, _staff: StaffIdentity = Depends(require_staff)) -> dict:
    """The saved state only; never runs the agent."""
    try:
        return _response(read_evaluation(request_id))
    except (RequestNotFoundError, NotCourseSubstitutionRequestError) as exc:
        raise _not_found(exc) from exc
    except SQLAlchemyError as exc:
        raise _unavailable(exc) from exc


@router.post("/{request_id}/evaluations")
def run_evaluation(
    body: EvaluationRequest,
    request_id: str = RequestId,
    staff: StaffIdentity = Depends(require_staff),
) -> dict:
    """rerun=false: run only if never evaluated, In Progress and the details exist
    (otherwise the saved state is returned, with `outcome` saying why).
    rerun=true: run again now, only while In Progress and the details exist
    (409 if another run is in progress, the request is no longer In Progress, or
    its Course Substitution details are missing)."""
    try:
        outcome = ensure_evaluation(request_id, staff, rerun=body.rerun)
        state = read_evaluation(request_id)
    except (RequestNotFoundError, NotCourseSubstitutionRequestError) as exc:
        raise _not_found(exc) from exc
    except RunInProgressError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "An eligibility check is already running for this request.") from exc
    except RerunNotAllowedError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Only In Progress requests can be evaluated again; the saved evaluations are kept.",
        ) from exc
    except CourseSubstitutionDetailsMissingError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, evaluation_service.DETAILS_MISSING_MESSAGE) from exc
    except SQLAlchemyError as exc:
        raise _unavailable(exc) from exc
    response = _response(state)
    response["evaluation"]["started_by_this_call"] = outcome.started
    response["evaluation"]["outcome"] = outcome.reason
    return response

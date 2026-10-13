"""Staff-only API for the Raise Capacity review page.

Every route depends on require_staff, which verifies the Supabase session and the
Authorized_Staff link BEFORE any request data is read or the agent runs.
The recommendation is advisory; nothing here approves, rejects or changes a request.
"""

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel

from app.agents.raise_capacity_eligibility.exceptions import NotRaiseCapacityRequestError, RequestNotFoundError
from app.agents.raise_capacity_eligibility.review import get_review
from app.agents.raise_capacity_eligibility.service import RunInProgressError, ensure_evaluation
from app.core.auth import StaffIdentity, require_staff

router = APIRouter(prefix="/api/staff/raise-capacity", tags=["raise-capacity-review"])

RequestId = Path(min_length=1, max_length=64)


class EvaluationRequest(BaseModel):
    rerun: bool = False


def _not_found(exc: Exception) -> HTTPException:
    if isinstance(exc, NotRaiseCapacityRequestError):
        return HTTPException(status.HTTP_404_NOT_FOUND, "This is not a Raise Capacity request.")
    return HTTPException(status.HTTP_404_NOT_FOUND, "Request not found.")


@router.get("/{request_id}/review")
def read_review(request_id: str = RequestId, _staff: StaffIdentity = Depends(require_staff)) -> dict:
    """The saved state only; never runs the agent."""
    try:
        return get_review(request_id)
    except (RequestNotFoundError, NotRaiseCapacityRequestError) as exc:
        raise _not_found(exc) from exc


@router.post("/{request_id}/evaluations")
def run_evaluation(
    body: EvaluationRequest,
    request_id: str = RequestId,
    staff: StaffIdentity = Depends(require_staff),
) -> dict:
    """rerun=false: run only if no evaluation exists yet (first opening).
    rerun=true: run again now (409 while another run is in progress)."""
    try:
        outcome = ensure_evaluation(request_id, staff, rerun=body.rerun)
        review = get_review(request_id)
    except (RequestNotFoundError, NotRaiseCapacityRequestError) as exc:
        raise _not_found(exc) from exc
    except RunInProgressError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    review["evaluation"]["started_by_this_call"] = outcome.started
    return review

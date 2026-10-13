"""Staff-only API for Raise Capacity priorities (the request list's priority column).

Every route depends on require_staff, which verifies the Supabase session and the
Authorized_Staff link BEFORE any request data is read or the agent runs.
A read failure is always an error response (503), never an empty priority, so the
list can tell "could not load" apart from "not prioritized yet".
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy.exc import SQLAlchemyError

from app.agents.raise_capacity_priority.service import (
    BusyError, RetryRefusedError, read_states, retry, start_automatic,
)
from app.core.auth import StaffIdentity, require_staff

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/staff/raise-capacity", tags=["raise-capacity-priority"])

MAX_IDS = 100
RequestIdText = Annotated[str, StringConstraints(min_length=1, max_length=64)]
RequestId = Path(min_length=1, max_length=64)


class AutomaticRequest(BaseModel):
    request_ids: list[RequestIdText] = Field(min_length=1, max_length=MAX_IDS)


def _unavailable(exc: SQLAlchemyError) -> HTTPException:
    log.warning("Priority data could not be read or written (%s)", type(exc).__name__)
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Priorities could not be loaded. Try again shortly.")


@router.get("/priorities")
def list_priorities(
    request_id: Annotated[list[RequestIdText], Query(min_length=1, max_length=MAX_IDS)],
    _staff: StaffIdentity = Depends(require_staff),
) -> dict:
    """Saved state only; never runs the agent."""
    try:
        return {"priorities": read_states(request_id)}
    except SQLAlchemyError as exc:
        raise _unavailable(exc) from exc


@router.post("/priorities/automatic")
def run_automatic(body: AutomaticRequest, staff: StaffIdentity = Depends(require_staff)) -> dict:
    """Starts checks for In Progress requests with no saved priority and no previous
    run (as many as this backend process has free slots); returns every request's
    state. Call again while some remain not_started or running."""
    try:
        return start_automatic(body.request_ids, staff)
    except SQLAlchemyError as exc:
        raise _unavailable(exc) from exc


@router.post("/{request_id}/priority/retry")
def retry_priority(request_id: str = RequestId, staff: StaffIdentity = Depends(require_staff)) -> dict:
    """Manual retry after a failed or interrupted check."""
    try:
        return {"priority": retry(request_id, staff)}
    except RetryRefusedError as exc:
        if exc.state["state"] == "not_found":
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Raise Capacity request not found.") from exc
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except BusyError as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(exc)) from exc
    except SQLAlchemyError as exc:
        raise _unavailable(exc) from exc

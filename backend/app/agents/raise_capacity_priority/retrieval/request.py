"""
Supabase retrieval for the Request table (Step 1 of the retrieval flow).

Confirms the Request_ID exists and is a Raise Capacity request before
anything downstream is retrieved.
"""

from typing import Any

from ..retrieval._query import select_rows
from ..retrieval.errors import InvalidRequestTypeError, RequestNotFoundError
from ..schemas.request import RequestRecord

RAISE_CAPACITY_REQUEST_TYPE = "Raise Capacity"

_COLUMNS = (
    "Request_ID, Request_Type, Request_Date, Submission_Time, "
    "Description, Current_Status, Student_ID"
)


def get_request(client: Any, request_id: str) -> RequestRecord:
    rows = select_rows(client, "Request", _COLUMNS, {"Request_ID": request_id})
    if not rows:
        raise RequestNotFoundError(
            f"No Request found for Request_ID={request_id!r}."
        )

    row = rows[0]
    if row["Request_Type"] != RAISE_CAPACITY_REQUEST_TYPE:
        raise InvalidRequestTypeError(
            f"Request_ID={request_id!r} has Request_Type={row['Request_Type']!r}, "
            f"expected {RAISE_CAPACITY_REQUEST_TYPE!r}."
        )

    return RequestRecord(
        request_id=row["Request_ID"],
        request_type=row["Request_Type"],
        request_date=row["Request_Date"],
        submission_time=row["Submission_Time"],
        description=row["Description"],
        current_status=row["Current_Status"],
        student_id=row["Student_ID"],
    )

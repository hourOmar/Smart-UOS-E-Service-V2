"""
Supabase retrieval for the Raise_Capacity table (Step 2 of the retrieval
flow).
"""

from typing import Any

from ..retrieval._query import select_rows
from ..retrieval.errors import RaiseCapacityRecordNotFoundError
from ..schemas.raise_capacity import RaiseCapacityDetails

_COLUMNS = "Request_ID, Reason, Course_ID, Section_ID, Term"


def get_raise_capacity_details(client: Any, request_id: str) -> RaiseCapacityDetails:
    rows = select_rows(client, "Raise_Capacity", _COLUMNS, {"Request_ID": request_id})
    if not rows:
        raise RaiseCapacityRecordNotFoundError(
            f"No Raise_Capacity row found for Request_ID={request_id!r}."
        )

    row = rows[0]
    return RaiseCapacityDetails(
        request_id=row["Request_ID"],
        reason=row["Reason"],
        course_id=row["Course_ID"],
        section_id=row["Section_ID"],
        term=row["Term"],
    )

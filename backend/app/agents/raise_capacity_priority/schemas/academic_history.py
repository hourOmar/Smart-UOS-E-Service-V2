"""
Pydantic schemas for a student's Takes history against the requested
course (Supabase Takes table).

`matches_current_request_context` flags a Takes row whose Section_ID and
Term are identical to the current Raise_Capacity request's own
Section_ID/Term. Such a row is very likely the student's current-term
registration tied to this very request, not a genuinely completed
previous attempt, so it is excluded from number_of_attempts/
attempted_before but kept in `records` for transparency rather than
silently discarded.
"""

from typing import Optional

from pydantic import BaseModel


class PreviousAttemptRecord(BaseModel):
    course_id: int  # integer
    grade: Optional[str]
    section_id: str  # character varying
    term: int
    matches_current_request_context: bool


class PreviousAttemptsSummary(BaseModel):
    attempted_before: bool
    number_of_attempts: int
    records: list[PreviousAttemptRecord]


class TakesRecord(BaseModel):
    """A raw Takes row for an arbitrary course (Phase 4 prerequisite
    evaluation). Unlike PreviousAttemptRecord, this is not scoped to the
    requested course and carries no matches_current_request_context flag
    — it is used to check completion of the requested course's
    PREREQUISITE courses, not the requested course itself."""

    course_id: int
    grade: Optional[str]
    section_id: str
    term: int

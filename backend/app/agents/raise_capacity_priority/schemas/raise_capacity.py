"""Pydantic schema for a Supabase Raise_Capacity row."""

from typing import Optional

from pydantic import BaseModel


class RaiseCapacityDetails(BaseModel):
    request_id: str  # character varying
    reason: Optional[str]
    course_id: int  # integer
    section_id: str  # character varying
    term: int

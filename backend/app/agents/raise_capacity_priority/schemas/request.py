"""Pydantic schema for a Supabase Request row (Request table)."""

from typing import Optional

from pydantic import BaseModel


class RequestRecord(BaseModel):
    request_id: str  # character varying
    request_type: str
    request_date: str
    submission_time: str
    description: Optional[str]
    current_status: str
    student_id: str  # character varying

"""Pydantic schema for a Supabase Section row."""

from pydantic import BaseModel


class SectionInfo(BaseModel):
    section_id: str  # character varying
    course_id: int  # integer
    term: int
    current_capacity: int
    total_capacity: int
    additional_capacity: int

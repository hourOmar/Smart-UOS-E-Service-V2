"""Pydantic schema for a Supabase Course row."""

from pydantic import BaseModel


class CourseInfo(BaseModel):
    course_id: int  # integer
    course_name: str
    credit_hours: int

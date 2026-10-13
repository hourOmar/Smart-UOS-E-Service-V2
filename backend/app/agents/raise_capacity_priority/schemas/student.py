"""
Pydantic schema for a Supabase Student row, limited to the fields this
agent needs for prioritization. Student_Email is deliberately excluded —
it plays no role in the prioritization decision.
"""

from typing import Optional

from pydantic import BaseModel


class StudentAcademicProfile(BaseModel):
    student_id: str  # character varying
    student_name: str
    cgpa: Optional[float]
    completed_hours: Optional[int]
    program_id: Optional[int]  # smallint, nullable
    expected_graduation_term: Optional[int]

"""
Aggregated Supabase evidence for a single Raise Capacity request.

This is NOT the final Agent 2 evidence package — it is only the Supabase
portion. Later phases add UoS study-plan evidence, deterministic
calculations, course-offering evidence, and the prioritization rules.
"""

from typing import Optional

from pydantic import BaseModel

from ..schemas.academic_history import PreviousAttemptsSummary
from ..schemas.course import CourseInfo
from ..schemas.program import ProgramInfo
from ..schemas.raise_capacity import RaiseCapacityDetails
from ..schemas.request import RequestRecord
from ..schemas.section import SectionInfo
from ..schemas.student import StudentAcademicProfile


class SupabaseEvidence(BaseModel):
    request: RequestRecord
    raise_capacity: RaiseCapacityDetails
    student: StudentAcademicProfile
    program: Optional[ProgramInfo]
    course: CourseInfo
    section: SectionInfo
    previous_attempts: PreviousAttemptsSummary

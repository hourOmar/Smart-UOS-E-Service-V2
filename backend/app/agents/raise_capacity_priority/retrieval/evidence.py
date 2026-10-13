"""
Aggregated Supabase-only evidence retrieval for a Raise Capacity request.

get_supabase_evidence(request_id) performs the fixed Step 1-7 retrieval
flow and returns one structured SupabaseEvidence object. This is NOT the
final Agent 2 evidence package — later phases add UoS, deterministic, and
course-offering evidence, plus the prioritization rules and Gemini's
decision.
"""

from typing import Any

from ..retrieval.academic_history import get_previous_attempts
from ..retrieval.course import get_course
from ..retrieval.program import get_program
from ..retrieval.raise_capacity import get_raise_capacity_details
from ..retrieval.request import get_request
from ..retrieval.section import get_section
from ..retrieval.student import get_student
from ..schemas.evidence import SupabaseEvidence


def get_supabase_evidence(request_id: str, client: Any) -> SupabaseEvidence:
    # Ported: `client` is required (the backend passes a read-only database
    # client, see ../db_client.py); there is no Supabase client default.
    request = get_request(client, request_id)
    raise_capacity = get_raise_capacity_details(client, request_id)
    student = get_student(client, request.student_id)
    program = get_program(client, student.program_id)
    course = get_course(client, raise_capacity.course_id)
    section = get_section(
        client,
        raise_capacity.section_id,
        raise_capacity.course_id,
        raise_capacity.term,
    )
    previous_attempts = get_previous_attempts(
        client,
        student_id=student.student_id,
        course_id=raise_capacity.course_id,
        current_section_id=raise_capacity.section_id,
        current_term=raise_capacity.term,
    )

    return SupabaseEvidence(
        request=request,
        raise_capacity=raise_capacity,
        student=student,
        program=program,
        course=course,
        section=section,
        previous_attempts=previous_attempts,
    )

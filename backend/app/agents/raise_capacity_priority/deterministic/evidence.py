"""
Aggregates every Phase 4 deterministic calculation into one
DeterministicEvidence object. This module does no I/O itself — it is a
pure function of data already retrieved (Phase 2's SupabaseEvidence,
Phase 3's UoSCourseEvidence, and the prerequisite-course Takes records a
caller fetched via app/retrieval/prerequisite_history.py). Keeping I/O
out of this package matches the fixed-pipeline architecture: retrieval
happens before deterministic calculation, never inside it.
"""

from ..deterministic.course_offerings import build_requested_course_offering_evidence
from ..deterministic.prerequisite_evaluator import evaluate_prerequisite_completion
from ..deterministic.previous_attempts import build_previous_attempt_summary
from ..deterministic.progression import build_progression_evidence
from ..deterministic.remaining_credits import calculate_remaining_credits
from ..schemas.academic_history import TakesRecord
from ..schemas.deterministic import DeterministicEvidence
from ..schemas.evidence import SupabaseEvidence
from ..schemas.uos import UoSCourseEvidence


def build_deterministic_evidence(
    supabase_evidence: SupabaseEvidence,
    uos_evidence: UoSCourseEvidence,
    prerequisite_takes_records: list[TakesRecord],
) -> DeterministicEvidence:
    completed_hours = supabase_evidence.student.completed_hours
    total_required_credits = (
        uos_evidence.total_degree_credits.total_required_credits
        if uos_evidence.total_degree_credits.verified
        else None
    )
    remaining_credits = calculate_remaining_credits(completed_hours, total_required_credits)

    prerequisite_completion = evaluate_prerequisite_completion(
        course_id=uos_evidence.course_id,
        uos_prereq_evidence=uos_evidence.prerequisites,
        takes_records=prerequisite_takes_records,
        current_request_term=supabase_evidence.raise_capacity.term,
    )

    requested_course_offering = build_requested_course_offering_evidence(
        course_id=supabase_evidence.raise_capacity.course_id,
        request_term=supabase_evidence.raise_capacity.term,
    )

    previous_attempt_summary = build_previous_attempt_summary(supabase_evidence.previous_attempts)

    progression_evidence = build_progression_evidence(uos_evidence.subsequent_course_impact)

    return DeterministicEvidence(
        remaining_credits=remaining_credits,
        prerequisite_completion=prerequisite_completion,
        requested_course_offering=requested_course_offering,
        previous_attempt_summary=previous_attempt_summary,
        progression_evidence=progression_evidence,
    )

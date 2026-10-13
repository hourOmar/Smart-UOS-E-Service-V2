"""
Derives Phase 4 previous-attempt summary evidence purely from the
PreviousAttemptsSummary Phase 2 already retrieved — no new Supabase
query. Preserves Phase 2's exclusion of Takes rows that match the
current request's own Section_ID/Term from genuine-attempt counts.
"""

from ..schemas.academic_history import PreviousAttemptsSummary
from ..schemas.deterministic import PreviousAttemptSummaryEvidence


def build_previous_attempt_summary(
    previous_attempts: PreviousAttemptsSummary,
) -> PreviousAttemptSummaryEvidence:
    genuine = [
        record
        for record in previous_attempts.records
        if not record.matches_current_request_context
    ]
    excluded = len(previous_attempts.records) - len(genuine)

    return PreviousAttemptSummaryEvidence(
        attempted_before=previous_attempts.attempted_before,
        number_of_attempts=previous_attempts.number_of_attempts,
        previous_grades=[record.grade for record in genuine],
        previous_terms=[record.term for record in genuine],
        excluded_current_context_records=excluded,
    )

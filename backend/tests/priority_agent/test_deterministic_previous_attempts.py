from app.agents.raise_capacity_priority.deterministic.previous_attempts import build_previous_attempt_summary
from app.agents.raise_capacity_priority.schemas.academic_history import PreviousAttemptRecord, PreviousAttemptsSummary
from app.agents.raise_capacity_priority.schemas.deterministic import PreviousAttemptSummaryEvidence


def _record(grade, term, matches_current=False):
    return PreviousAttemptRecord(
        course_id=1501215,
        grade=grade,
        section_id="SEC-1",
        term=term,
        matches_current_request_context=matches_current,
    )


# 38. No previous attempts
def test_no_previous_attempts():
    summary = PreviousAttemptsSummary(attempted_before=False, number_of_attempts=0, records=[])
    evidence = build_previous_attempt_summary(summary)
    assert evidence.attempted_before is False
    assert evidence.number_of_attempts == 0
    assert evidence.previous_grades == []
    assert evidence.previous_terms == []
    assert evidence.excluded_current_context_records == 0


# 39. One attempt
def test_one_attempt():
    records = [_record("D", 202410)]
    summary = PreviousAttemptsSummary(attempted_before=True, number_of_attempts=1, records=records)
    evidence = build_previous_attempt_summary(summary)
    assert evidence.number_of_attempts == 1
    assert evidence.previous_grades == ["D"]
    assert evidence.previous_terms == [202410]


# 40. Multiple attempts
def test_multiple_attempts():
    records = [_record("D", 202410), _record("F", 202420)]
    summary = PreviousAttemptsSummary(attempted_before=True, number_of_attempts=2, records=records)
    evidence = build_previous_attempt_summary(summary)
    assert evidence.number_of_attempts == 2
    assert evidence.previous_grades == ["D", "F"]
    assert evidence.previous_terms == [202410, 202420]


# 41. Current-context record excluded correctly
def test_current_context_record_excluded():
    records = [_record("D", 202410), _record(None, 202601, matches_current=True)]
    summary = PreviousAttemptsSummary(attempted_before=True, number_of_attempts=1, records=records)
    evidence = build_previous_attempt_summary(summary)
    assert evidence.number_of_attempts == 1
    assert evidence.previous_grades == ["D"]
    assert evidence.previous_terms == [202410]
    assert evidence.excluded_current_context_records == 1


# Schema-stability guard: confirms this policy/prompt-only change did not
# add fields such as a grade classification or duplicate-attempt flag to
# the evidence schema.
def test_previous_attempt_summary_evidence_field_set_is_unchanged():
    assert set(PreviousAttemptSummaryEvidence.model_fields.keys()) == {
        "attempted_before",
        "number_of_attempts",
        "previous_grades",
        "previous_terms",
        "excluded_current_context_records",
    }

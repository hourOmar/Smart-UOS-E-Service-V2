from app.agents.raise_capacity_priority.pipeline.gemini_prompt import build_gemini_prompt
from app.agents.raise_capacity_priority.schemas.deterministic import (
    PreviousAttemptSummaryEvidence,
    PrerequisiteCompletionEvidence,
    ProgressionEvidence,
    RemainingCreditsEvidence,
    RequestedCourseOfferingEvidence,
)
from app.agents.raise_capacity_priority.schemas.prioritization_evidence import (
    EvidenceQualitySummary,
    GraduationEvidence,
    PrioritizationEvidencePackage,
    RequestContext,
)
from app.agents.raise_capacity_priority.schemas.uos import CourseCategoryEvidence

POLICY = {
    "raise_capacity_prioritization_rules": [{"rule_id": 1, "name": "Expected Graduation", "description": "..."}],
    "priority_levels": {"High": "...", "Medium": "...", "Low": "..."},
}


def _evidence(
    reason="I need this course to graduate.",
    has_missing=False,
    has_conflicting=False,
    issues=None,
):
    if issues is None:
        issues = []
    return PrioritizationEvidencePackage(
        request_context=RequestContext(
            request_id="REQ-1",
            student_id="S1",
            request_term=202601,
            course_id=1501215,
            course_name="Data Structures",
            section_id="SEC-1",
            reason=reason,
        ),
        graduation=GraduationEvidence(
            request_term=202601,
            expected_graduation_term=202802,
            same_as_expected_graduation_term=False,
            terms_until_graduation_including_summer=7,
            terms_until_graduation_excluding_summer=5,
        ),
        degree_progress=RemainingCreditsEvidence(
            completed_hours=90, total_required_credits=123, remaining_credits=33, status="OK", note=None
        ),
        requested_course_requirement=CourseCategoryEvidence(
            course_id=1501215,
            course_name="Data Structures",
            found=True,
            category="MANDATORY_CORE",
            specific_course_mandatory=True,
            credit_hours=3,
            source_url="https://example.com",
        ),
        course_availability=RequestedCourseOfferingEvidence(
            course_id=1501215,
            found_in_kb=True,
            fall=True,
            spring=True,
            summer=True,
            offered_semester_count=3,
            offered_semesters=["FALL", "SPRING", "SUMMER"],
            summer_available=True,
            current_semester="FALL",
            next_semester="SPRING",
            offered_next_semester=True,
            term_suffix_supported=True,
            source="app/knowledge/raise_capacity/course_offerings.json",
        ),
        previous_attempts=PreviousAttemptSummaryEvidence(
            attempted_before=False, number_of_attempts=0, previous_grades=[], previous_terms=[],
            excluded_current_context_records=0,
        ),
        prerequisite_completion=PrerequisiteCompletionEvidence(
            course_id=1501215, status="SATISFIED", reason="Passed 1501211.", source_section_used="DEGREE_REQUIREMENTS",
            relation="PREREQUISITE", requirement_expression=None, leaf_evaluations=[], uos_conflict=False,
            uos_conflict_reason=None,
        ),
        progression=ProgressionEvidence(
            requested_course_id=1501215, total_dependent_courses=17, mandatory_or_core_dependent_count=11,
            elective_dependent_count=6, always_required_dependent_count=17, or_alternative_dependent_count=0,
            dependent_courses_missing_from_offerings_kb=0, dependent_courses=[],
        ),
        evidence_quality=EvidenceQualitySummary(
            has_missing_evidence=has_missing, has_conflicting_evidence=has_conflicting, issues=issues
        ),
    )


# 8. Evidence included
def test_evidence_included_in_prompt():
    _, user_content = build_gemini_prompt(_evidence(), POLICY)
    assert '"request_id": "REQ-1"' in user_content
    assert '"category": "MANDATORY_CORE"' in user_content


# 9. Policy included
def test_policy_included_in_prompt():
    _, user_content = build_gemini_prompt(_evidence(), POLICY)
    assert "Expected Graduation" in user_content
    assert '"High"' in user_content


# 10. Evidence and policy clearly separated
def test_evidence_and_policy_clearly_separated():
    _, user_content = build_gemini_prompt(_evidence(), POLICY)
    policy_marker = user_content.index("=== POLICY")
    evidence_marker = user_content.index("=== EVIDENCE")
    assert policy_marker < evidence_marker


# 11. Request reason identified as unverified/student-provided context
def test_reason_identified_as_unverified_context():
    system_instruction, _ = build_gemini_prompt(_evidence(), POLICY)
    assert "student-provided context, not verified fact" in system_instruction


# 12. Anti-hallucination instructions present
def test_anti_hallucination_instructions_present():
    system_instruction, _ = build_gemini_prompt(_evidence(), POLICY)
    for phrase in [
        "Do not invent student facts",
        "Do not assume a value for anything",
        "Do not use outside knowledge",
        "unavailable",
    ]:
        assert phrase in system_instruction


# 13. Told not to recompute deterministic values
def test_told_not_to_recompute_deterministic_values():
    system_instruction, _ = build_gemini_prompt(_evidence(), POLICY)
    assert "Do not recompute" in system_instruction


# 14. Told no tool/database/web access
def test_told_no_tool_database_web_access():
    system_instruction, _ = build_gemini_prompt(_evidence(), POLICY)
    assert "no access to Supabase, the UoS website" in system_instruction
    assert "do not call any tool" in system_instruction.lower()


# 20. Missing evidence can be passed to Gemini
def test_missing_evidence_flows_into_prompt():
    _, user_content = build_gemini_prompt(
        _evidence(has_missing=True, issues=["Student's Expected_Graduation_Term is missing."]), POLICY
    )
    assert '"has_missing_evidence": true' in user_content
    assert "Expected_Graduation_Term is missing" in user_content


# 21. Conflicting evidence can be passed to Gemini
def test_conflicting_evidence_flows_into_prompt():
    _, user_content = build_gemini_prompt(
        _evidence(has_conflicting=True, issues=["Official UoS prerequisite sources conflict: ..."]), POLICY
    )
    assert '"has_conflicting_evidence": true' in user_content
    assert "prerequisite sources conflict" in user_content


# Previous-attempt factor: uses attempted_before, ignores count/grade,
# considered alongside the other factors (not standalone determinative).
def test_previous_attempt_instructions_use_attempted_before():
    system_instruction, _ = build_gemini_prompt(_evidence(), POLICY)
    assert "previous_attempts.attempted_before" in system_instruction
    assert "higher priority on this factor" in system_instruction


def test_previous_attempt_instructions_ignore_attempt_count():
    system_instruction, _ = build_gemini_prompt(_evidence(), POLICY)
    assert (
        "Do not increase or decrease priority based on "
        "previous_attempts.number_of_attempts" in system_instruction
    )
    assert "regardless of how many times" in system_instruction


def test_previous_attempt_instructions_ignore_grades():
    system_instruction, _ = build_gemini_prompt(_evidence(), POLICY)
    assert (
        "Do not increase or decrease priority based on "
        "previous_attempts.previous_grades" in system_instruction
    )
    assert "failed attempt and a passed attempt are treated equally" in system_instruction


def test_previous_attempt_factor_not_standalone_determinative():
    system_instruction, _ = build_gemini_prompt(_evidence(), POLICY)
    assert "weighed alongside the other six factors" in system_instruction
    assert (
        "Do not let previous attempts alone determine the final "
        "HIGH, MEDIUM, or LOW priority" in system_instruction
    )


def test_previous_attempt_factor_explanation_requirement_present():
    system_instruction, _ = build_gemini_prompt(_evidence(), POLICY)
    assert (
        "previous_attempts explanation must be based on "
        "previous_attempts.attempted_before" in system_instruction
    )


# 23-25. Data minimization
def test_student_email_not_sent():
    _, user_content = build_gemini_prompt(_evidence(), POLICY)
    assert "email" not in user_content.lower()


def test_auth_user_id_not_sent():
    _, user_content = build_gemini_prompt(_evidence(), POLICY)
    assert "auth_user_id" not in user_content.lower()


def test_credentials_not_sent():
    system_instruction, user_content = build_gemini_prompt(_evidence(), POLICY)
    combined = (system_instruction + user_content).lower()
    assert "supabase_key" not in combined
    assert "gemini_api_key" not in combined
    assert "api_key" not in combined

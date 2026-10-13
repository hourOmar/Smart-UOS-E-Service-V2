"""
Tests for the Phase 5 evidence assembler. Uses assemble_prioritization_
evidence(...) directly (no network/Supabase) with hand-built Phase 2/3
evidence objects, then runs them through the REAL Phase 4
build_deterministic_evidence so Phase 4's own already-tested logic
computes the results Phase 5 is responsible for correctly carrying
through — Phase 5's job is assembly/pass-through, and these tests check
exactly that.
"""

import inspect

from app.agents.raise_capacity_priority.deterministic.evidence import build_deterministic_evidence
from app.agents.raise_capacity_priority.pipeline import build_prioritization_evidence as pipeline_module
from app.agents.raise_capacity_priority.pipeline.build_prioritization_evidence import assemble_prioritization_evidence
from app.agents.raise_capacity_priority.retrieval.uos_prerequisite_parser import parse_prerequisite_text
from app.agents.raise_capacity_priority.schemas.academic_history import (
    PreviousAttemptRecord,
    PreviousAttemptsSummary,
    TakesRecord,
)
from app.agents.raise_capacity_priority.schemas.course import CourseInfo
from app.agents.raise_capacity_priority.schemas.evidence import SupabaseEvidence
from app.agents.raise_capacity_priority.schemas.program import ProgramInfo
from app.agents.raise_capacity_priority.schemas.raise_capacity import RaiseCapacityDetails
from app.agents.raise_capacity_priority.schemas.request import RequestRecord
from app.agents.raise_capacity_priority.schemas.section import SectionInfo
from app.agents.raise_capacity_priority.schemas.student import StudentAcademicProfile
from app.agents.raise_capacity_priority.schemas.uos import (
    CourseCategoryEvidence,
    DependentCourse,
    PrerequisiteEvidence,
    SubsequentCourseImpactEvidence,
    TotalDegreeCreditsEvidence,
    UoSCourseEvidence,
)

SOURCE_URL = "https://www.sharjah.ac.ae/en/Academics/Degree/Undergraduate/Computer-Science"


def _supabase_evidence(
    request_id="REQ-1",
    student_id="S1",
    term=202601,
    course_id=1501215,
    section_id="SEC-1",
    reason="Needed for progress.",
    expected_graduation_term=202601,
    completed_hours=90,
    previous_attempts=None,
):
    if previous_attempts is None:
        previous_attempts = PreviousAttemptsSummary(attempted_before=False, number_of_attempts=0, records=[])
    return SupabaseEvidence(
        request=RequestRecord(
            request_id=request_id,
            request_type="Raise Capacity",
            request_date="2026-09-01",
            submission_time="09:00:00",
            description="desc",
            current_status="Pending",
            student_id=student_id,
        ),
        raise_capacity=RaiseCapacityDetails(
            request_id=request_id, reason=reason, course_id=course_id, section_id=section_id, term=term
        ),
        student=StudentAcademicProfile(
            student_id=student_id,
            student_name="Test Student",
            cgpa=3.5,
            completed_hours=completed_hours,
            program_id=12,
            expected_graduation_term=expected_graduation_term,
        ),
        program=ProgramInfo(program_id=12, program_name="Computer Science", college_name="CCI"),
        course=CourseInfo(course_id=course_id, course_name="Data Structures", credit_hours=3),
        section=SectionInfo(
            section_id=section_id,
            course_id=course_id,
            term=term,
            current_capacity=30,
            total_capacity=30,
            additional_capacity=5,
        ),
        previous_attempts=previous_attempts,
    )


def _uos_evidence(
    course_id=1501215,
    category="MANDATORY_CORE",
    specific_mandatory=True,
    category_found=True,
    prereq_raw_text="1501211",
    conflict=False,
    dependent_courses=None,
):
    if dependent_courses is None:
        dependent_courses = []
    if conflict:
        parsed = [
            parse_prerequisite_text("1502201", "DEGREE_REQUIREMENTS"),
            parse_prerequisite_text("1403201", "STUDY_PLAN"),
        ]
    else:
        parsed = [parse_prerequisite_text(prereq_raw_text, "DEGREE_REQUIREMENTS")]

    return UoSCourseEvidence(
        course_id=course_id,
        source_url=SOURCE_URL,
        total_degree_credits=TotalDegreeCreditsEvidence(
            total_required_credits=123,
            verified=True,
            retrieval_status="OK",
            raw_values_found=[123],
            source_url=SOURCE_URL,
        ),
        category=CourseCategoryEvidence(
            course_id=course_id,
            course_name="Data Structures",
            found=category_found,
            category=category if category_found else None,
            specific_course_mandatory=specific_mandatory if category_found else None,
            credit_hours=3,
            source_url=SOURCE_URL,
        ),
        prerequisites=PrerequisiteEvidence(
            course_id=course_id,
            course_found=True,
            by_source=parsed,
            consistent=not conflict,
            conflict=conflict,
            conflict_reason="Prerequisite text differs across sections." if conflict else None,
            source_url=SOURCE_URL,
        ),
        subsequent_course_impact=SubsequentCourseImpactEvidence(
            requested_course_id=course_id,
            dependent_courses=dependent_courses,
            dependent_mandatory_or_core_count=sum(
                1 for d in dependent_courses if d.category in ("MANDATORY", "MANDATORY_CORE")
            ),
            dependent_elective_count=sum(1 for d in dependent_courses if d.category == "ELECTIVE"),
            source_url=SOURCE_URL,
        ),
        study_plan_entry=None,
    )


def _package(supabase_evidence=None, uos_evidence=None, takes_records=None):
    supabase_evidence = supabase_evidence or _supabase_evidence()
    uos_evidence = uos_evidence or _uos_evidence()
    takes_records = [] if takes_records is None else takes_records
    deterministic_evidence = build_deterministic_evidence(supabase_evidence, uos_evidence, takes_records)
    return assemble_prioritization_evidence(supabase_evidence, uos_evidence, deterministic_evidence)


# 1-5: request context
def test_complete_evidence_package_builds():
    package = _package()
    assert package is not None


def test_correct_request_id():
    package = _package(supabase_evidence=_supabase_evidence(request_id="REQ-42"))
    assert package.request_context.request_id == "REQ-42"


def test_correct_student_id():
    package = _package(supabase_evidence=_supabase_evidence(student_id="S-99"))
    assert package.request_context.student_id == "S-99"


def test_correct_requested_course_id():
    package = _package(
        supabase_evidence=_supabase_evidence(course_id=1501211),
        uos_evidence=_uos_evidence(course_id=1501211, prereq_raw_text="1501116"),
    )
    assert package.request_context.course_id == 1501211


def test_request_reason_included_when_available():
    package = _package(supabase_evidence=_supabase_evidence(reason="Because of a scheduling conflict."))
    assert package.request_context.reason == "Because of a scheduling conflict."


def test_request_reason_none_when_unavailable():
    package = _package(supabase_evidence=_supabase_evidence(reason=None))
    assert package.request_context.reason is None


# 6-8: graduation
def test_graduation_request_term_equals_expected():
    package = _package(
        supabase_evidence=_supabase_evidence(term=202601, expected_graduation_term=202601)
    )
    assert package.graduation.same_as_expected_graduation_term is True
    assert package.graduation.terms_until_graduation_including_summer == 0
    assert package.graduation.terms_until_graduation_excluding_summer == 0


def test_graduation_different_terms():
    package = _package(
        supabase_evidence=_supabase_evidence(term=202601, expected_graduation_term=202802)
    )
    assert package.graduation.same_as_expected_graduation_term is False
    assert package.graduation.terms_until_graduation_including_summer == 7
    assert package.graduation.terms_until_graduation_excluding_summer == 5


def test_graduation_missing_expected_term_is_unresolved():
    package = _package(supabase_evidence=_supabase_evidence(expected_graduation_term=None))
    assert package.graduation.same_as_expected_graduation_term is None
    assert package.graduation.expected_graduation_term is None
    assert package.graduation.terms_until_graduation_including_summer is None
    assert package.graduation.terms_until_graduation_excluding_summer is None


def test_graduation_summer_term_terms_until_excludes_summer_from_count():
    package = _package(
        supabase_evidence=_supabase_evidence(term=202601, expected_graduation_term=202603)
    )
    assert package.graduation.expected_graduation_term == 202603  # preserved as-is
    assert package.graduation.terms_until_graduation_including_summer == 2
    assert package.graduation.terms_until_graduation_excluding_summer == 1


def test_graduation_invalid_expected_term_suffix_sets_missing_flag():
    package = _package(
        supabase_evidence=_supabase_evidence(term=202601, expected_graduation_term=202699)
    )
    assert package.graduation.terms_until_graduation_including_summer is None
    assert package.graduation.terms_until_graduation_excluding_summer is None
    assert package.evidence_quality.has_missing_evidence is True
    assert any(
        "unsupported semester suffix" in issue for issue in package.evidence_quality.issues
    )


def test_graduation_expected_term_before_request_term_sets_conflicting_flag():
    package = _package(
        supabase_evidence=_supabase_evidence(term=202602, expected_graduation_term=202601)
    )
    assert package.graduation.terms_until_graduation_including_summer is None
    assert package.graduation.terms_until_graduation_excluding_summer is None
    assert package.evidence_quality.has_conflicting_evidence is True
    assert any(
        "chronologically before" in issue for issue in package.evidence_quality.issues
    )


# 9-11: degree progress
def test_remaining_credits_carried_from_phase4():
    package = _package(supabase_evidence=_supabase_evidence(completed_hours=90))
    assert package.degree_progress.remaining_credits == 33
    assert package.degree_progress.status == "OK"


def test_remaining_credits_unresolved_preserved():
    package = _package(supabase_evidence=_supabase_evidence(completed_hours=None))
    assert package.degree_progress.status == "UNRESOLVED"
    assert package.degree_progress.remaining_credits is None


def test_remaining_credits_anomaly_preserved():
    package = _package(supabase_evidence=_supabase_evidence(completed_hours=200))
    assert package.degree_progress.status == "ANOMALY"
    assert package.degree_progress.remaining_credits == -77


# 12-13: course requirement
def test_mandatory_core_course_requirement_preserved():
    package = _package(uos_evidence=_uos_evidence(category="MANDATORY_CORE", specific_mandatory=True))
    assert package.requested_course_requirement.category == "MANDATORY_CORE"
    assert package.requested_course_requirement.specific_course_mandatory is True


def test_elective_course_requirement_preserved():
    package = _package(uos_evidence=_uos_evidence(category="ELECTIVE", specific_mandatory=False))
    assert package.requested_course_requirement.category == "ELECTIVE"
    assert package.requested_course_requirement.specific_course_mandatory is False


# 14-17: availability
def test_fall_spring_summer_values_preserved():
    package = _package(
        supabase_evidence=_supabase_evidence(course_id=1501215),
        uos_evidence=_uos_evidence(course_id=1501215),
    )
    assert package.course_availability.fall is True
    assert package.course_availability.spring is True
    assert package.course_availability.summer is True


def test_offered_next_semester_preserved():
    package = _package(
        supabase_evidence=_supabase_evidence(course_id=1501215, term=202601),
        uos_evidence=_uos_evidence(course_id=1501215),
    )
    assert package.course_availability.next_semester == "SPRING"
    assert package.course_availability.offered_next_semester is True


def test_summer_available_preserved():
    package = _package(
        supabase_evidence=_supabase_evidence(course_id=1501215),
        uos_evidence=_uos_evidence(course_id=1501215),
    )
    assert package.course_availability.summer_available is True


def test_missing_kb_offering_evidence_preserved():
    package = _package(
        supabase_evidence=_supabase_evidence(course_id=9999999, term=202601),
        uos_evidence=_uos_evidence(course_id=9999999, category_found=False, prereq_raw_text="None"),
    )
    assert package.course_availability.found_in_kb is False
    assert package.course_availability.fall is None
    assert package.evidence_quality.has_missing_evidence is True


# 18-19: previous attempts
def test_no_previous_attempts():
    package = _package()
    assert package.previous_attempts.attempted_before is False
    assert package.previous_attempts.number_of_attempts == 0


def test_multiple_previous_attempts():
    records = [
        PreviousAttemptRecord(course_id=1501215, grade="D", section_id="OLD-1", term=202410, matches_current_request_context=False),
        PreviousAttemptRecord(course_id=1501215, grade="F", section_id="OLD-2", term=202420, matches_current_request_context=False),
    ]
    summary = PreviousAttemptsSummary(attempted_before=True, number_of_attempts=2, records=records)
    package = _package(supabase_evidence=_supabase_evidence(previous_attempts=summary))
    assert package.previous_attempts.number_of_attempts == 2
    assert package.previous_attempts.previous_grades == ["D", "F"]


# 20-23: prerequisite completion
def test_prerequisite_satisfied_preserved():
    takes = [TakesRecord(course_id=1501211, grade="B", section_id="X", term=202502)]
    package = _package(
        uos_evidence=_uos_evidence(prereq_raw_text="1501211"), takes_records=takes
    )
    assert package.prerequisite_completion.status == "SATISFIED"


def test_prerequisite_not_satisfied_preserved():
    package = _package(uos_evidence=_uos_evidence(prereq_raw_text="1501211"), takes_records=[])
    assert package.prerequisite_completion.status == "NOT_SATISFIED"


def test_prerequisite_unresolved_preserved():
    package = _package(uos_evidence=_uos_evidence(prereq_raw_text="Junior Standing"), takes_records=[])
    assert package.prerequisite_completion.status == "UNRESOLVED"


def test_prerequisite_conflict_preserved():
    package = _package(uos_evidence=_uos_evidence(conflict=True), takes_records=[])
    assert package.prerequisite_completion.status == "CONFLICT"
    assert package.prerequisite_completion.uos_conflict is True


# 24-26: progression
def test_dependency_counts_preserved():
    deps = [
        DependentCourse(course_id=1501263, course_name="DB", category="MANDATORY_CORE", specific_course_mandatory=True, always_required=True, study_plan_year=3, study_plan_semester=1),
        DependentCourse(course_id=1501445, course_name="ITE", category="ELECTIVE", specific_course_mandatory=False, always_required=False, study_plan_year=None, study_plan_semester=None),
    ]
    package = _package(uos_evidence=_uos_evidence(dependent_courses=deps))
    assert package.progression.total_dependent_courses == 2
    assert package.progression.mandatory_or_core_dependent_count == 1
    assert package.progression.elective_dependent_count == 1
    assert package.progression.or_alternative_dependent_count == 1


def test_dependent_course_records_preserved():
    deps = [
        DependentCourse(course_id=1501263, course_name="Intro. to Database Management System", category="MANDATORY_CORE", specific_course_mandatory=True, always_required=True, study_plan_year=3, study_plan_semester=1),
    ]
    package = _package(uos_evidence=_uos_evidence(dependent_courses=deps))
    record = package.progression.dependent_courses[0]
    assert record.course_id == 1501263
    assert record.course_name == "Intro. to Database Management System"
    assert record.category == "MANDATORY_CORE"
    assert record.found_in_offerings_kb is True


def test_progression_missing_offering_evidence_preserved():
    deps = [
        DependentCourse(course_id=9999999, course_name="Ghost Course", category="MANDATORY_CORE", specific_course_mandatory=True, always_required=True, study_plan_year=None, study_plan_semester=None),
    ]
    package = _package(uos_evidence=_uos_evidence(dependent_courses=deps))
    assert package.progression.dependent_courses_missing_from_offerings_kb == 1
    assert package.progression.dependent_courses[0].found_in_offerings_kb is False
    assert package.evidence_quality.has_missing_evidence is True


# 27-31: evidence quality
def test_complete_evidence_has_no_flags():
    package = _package()
    assert package.evidence_quality.has_missing_evidence is False
    assert package.evidence_quality.has_conflicting_evidence is False
    assert package.evidence_quality.issues == []


def test_missing_graduation_term_sets_missing_flag():
    package = _package(supabase_evidence=_supabase_evidence(expected_graduation_term=None))
    assert package.evidence_quality.has_missing_evidence is True
    assert any("Expected_Graduation_Term" in issue for issue in package.evidence_quality.issues)


def test_missing_offering_data_sets_missing_flag():
    package = _package(
        supabase_evidence=_supabase_evidence(course_id=9999999),
        uos_evidence=_uos_evidence(course_id=9999999, category_found=False, prereq_raw_text="None"),
    )
    assert package.evidence_quality.has_missing_evidence is True
    assert any("course-offerings" in issue for issue in package.evidence_quality.issues)


def test_uos_conflict_sets_conflicting_flag():
    package = _package(uos_evidence=_uos_evidence(conflict=True))
    assert package.evidence_quality.has_conflicting_evidence is True
    assert any("conflict" in issue.lower() for issue in package.evidence_quality.issues)


def test_multiple_issues_accumulate():
    package = _package(
        supabase_evidence=_supabase_evidence(expected_graduation_term=None, course_id=9999999),
        uos_evidence=_uos_evidence(course_id=9999999, category_found=False, conflict=True),
    )
    assert package.evidence_quality.has_missing_evidence is True
    assert package.evidence_quality.has_conflicting_evidence is True
    assert len(package.evidence_quality.issues) >= 3


# 32-34: data minimization
def test_student_email_not_present():
    package = _package()
    assert "email" not in package.model_dump_json().lower()


def test_auth_user_id_not_present():
    package = _package()
    assert "auth_user_id" not in package.model_dump_json().lower()


def test_no_internal_database_id_field():
    from app.agents.raise_capacity_priority.schemas.prioritization_evidence import PrioritizationEvidencePackage, RequestContext

    fields = set(PrioritizationEvidencePackage.model_fields.keys())
    assert "id" not in fields
    request_context_fields = set(RequestContext.model_fields.keys())
    assert request_context_fields == {
        "request_id",
        "student_id",
        "request_term",
        "course_id",
        "course_name",
        "section_id",
        "reason",
    }


# 35-37: no priority decision
def test_no_priority_field_exists():
    package = _package()
    assert "priority" not in package.model_dump_json().lower()


def test_no_high_medium_low_result_exists():
    dumped = _package().model_dump_json()
    assert '"HIGH"' not in dumped
    assert '"MEDIUM"' not in dumped
    assert '"LOW"' not in dumped


def test_gemini_is_not_called_or_imported():
    # The module's docstring legitimately explains that Gemini is NOT
    # called here, so a bare substring check on the whole source would
    # false-positive on that explanation. Check for an actual import or
    # attribute access instead.
    source = inspect.getsource(pipeline_module)
    assert "gemini_client" not in source.lower()
    assert "gemini." not in source.lower()
    assert "genai" not in source.lower()

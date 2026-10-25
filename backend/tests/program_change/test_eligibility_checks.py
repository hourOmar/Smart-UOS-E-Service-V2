"""Shaikha's deterministic checks (eligibility_checks.py): CGPA threshold,
completed hours, applicable hours by exact Course_ID, her error behaviour for
unknown grades, and courses with no grade yet (in progress), which count
toward neither total. All transcripts are synthetic."""

import pytest

from app.agents.program_change_eligibility import eligibility_checks as checks

from .fakes import (
    ARABIC_LANGUAGE, BASIC_ENGLISH, PLAN_COURSES, approve_transcript, course, program_change_request,
)


def test_university_course_file_is_loaded():
    courses = checks.load_university_courses()
    assert courses[BASIC_ENGLISH] == {"course_id": BASIC_ENGLISH, "course_name": "Basic English", "credit_hours": 3}
    assert ARABIC_LANGUAGE in courses


def test_the_academic_requirements_are_unchanged():
    assert checks.MIN_CGPA == 2.0
    assert checks.MIN_APPLICABLE_HOURS == 15


@pytest.mark.parametrize("cgpa, eligible", [(2.0, True), (2.01, True), (3.6, True), (1.99, False), (0.0, False)])
def test_cgpa_threshold_is_2_point_0_inclusive(cgpa, eligible):
    assert checks.check_cgpa(cgpa) is eligible


@pytest.mark.parametrize("hours, eligible", [(15, True), (16, True), (24, True), (14, False), (0, False)])
def test_applicable_hours_threshold_is_15_inclusive(hours, eligible):
    assert checks.check_applicable_hours(hours) is eligible


def test_completed_hours_exclude_f():
    transcript = [course("A1", "A"), course("A2", "F"), course("A3", "D", credit_hours=4)]
    assert checks.calculate_completed_hours(transcript) == 7


def test_applicable_hours_use_exact_course_ids_plan_and_university_pool():
    total, matched = checks.calculate_program_applicable_hours(approve_transcript(), PLAN_COURSES)
    assert total == 24
    assert [c["course_id"] for c in matched] == [
        BASIC_ENGLISH, ARABIC_LANGUAGE, "0201301", "0201302", "0201303", "0201304", "0201305", "0201306"]
    assert "1501215" not in {c["course_id"] for c in matched}   # not in plan or pool
    assert "0201307" not in {c["course_id"] for c in matched}   # in plan, but F


def test_course_names_never_establish_a_match():
    transcript = [course("9999999", "A", name="Plan Course 1")]   # same name, different ID
    assert checks.calculate_program_applicable_hours(transcript, PLAN_COURSES) == (0, [])


def test_a_retaken_course_counts_once_toward_applicable_hours():
    transcript = [course("0201301", "F", term=202401), course("0201301", "C", term=202402),
                  course("0201302", "D", term=202401), course("0201302", "B", term=202402)]
    total, matched = checks.calculate_program_applicable_hours(transcript, PLAN_COURSES)
    assert total == 6 and [c["grade"] for c in matched] == ["C", "D"]   # first completed attempt
    # Her completed-hours total counts every completed attempt (documented, unchanged).
    assert checks.calculate_completed_hours(transcript) == 9


@pytest.mark.parametrize("transcript, cgpa, applicable, cgpa_ok, hours_ok", [
    # Same outcomes as the standalone test requests 000048/49/50 (synthetic data):
    (approve_transcript(), 3.1, 24, True, True),
    ([course(BASIC_ENGLISH, "A"), course("0201301", "B"), course("0201302", "C"),
      course("1501216", "A"), course("1501215", "B")], 2.5, 9, True, False),   # 1501216/1501215: not applicable
    ([course(BASIC_ENGLISH, "C"), course("0201301", "D"), course("0201302", "D+"),
      course("0201303", "C"), course("0201304", "D")], 1.8, 15, False, True),   # exactly 15: passes
    ([course(BASIC_ENGLISH, "C"), course("0201301", "D"), course("0201302", "D+"),
      course("0201303", "C")], 2.0, 12, True, False),                          # exactly 2.0: passes
])
def test_run_basic_checks(transcript, cgpa, applicable, cgpa_ok, hours_ok):
    result = checks.run_basic_checks(program_change_request(transcript, cgpa=cgpa), PLAN_COURSES)
    assert result["cgpa"] == cgpa
    assert result["cgpa_eligible"] is cgpa_ok
    assert result["applicable_hours"] == applicable
    assert len(result["matched_courses"]) == applicable // 3
    assert result["completed_hours"] == checks.calculate_completed_hours(transcript)
    assert result["min_cgpa"] == 2.0 and result["min_applicable_hours"] == 15
    assert result["applicable_hours_eligible"] is hours_ok


def test_run_basic_checks_returns_the_original_keys_plus_the_structured_ones():
    result = checks.run_basic_checks(program_change_request(approve_transcript()), PLAN_COURSES)
    assert set(result) == {"cgpa", "cgpa_eligible", "completed_hours", "applicable_hours", "matched_courses",
                           "min_cgpa", "min_applicable_hours", "applicable_hours_eligible"}


def test_missing_cgpa_is_an_error():
    request = program_change_request([], cgpa=None)
    with pytest.raises(ValueError, match="CGPA is missing"):
        checks.run_basic_checks(request, PLAN_COURSES)


@pytest.mark.parametrize("grade", ["WF", "FA", "W", "I", "P"])
def test_grades_outside_a_to_f_are_an_error(grade):
    # Unchanged standalone behaviour: an unknown grade stops the agent.
    with pytest.raises(ValueError, match=f"Unknown grade: {grade}"):
        checks.calculate_completed_hours([course("A1", grade)])


@pytest.mark.parametrize("grade", ["A", "B+", "B", "C+", "C", "D+", "D", " b+ ", "a"])
def test_recognized_passing_grades_are_completed(grade):
    assert checks.is_completed_grade(grade) is True


def test_f_is_not_completed():
    assert checks.is_completed_grade("F") is False


@pytest.mark.parametrize("grade", [None, "", "   "])
def test_a_course_with_no_grade_yet_is_not_completed(grade):
    # NULL in Takes: the course is still in progress.
    assert checks.is_completed_grade(grade) is False


@pytest.mark.parametrize("grade", [None, "", "   "])
def test_courses_in_progress_count_toward_neither_total(grade):
    # 0201301 is in the plan and BASIC_ENGLISH in the university pool: with no
    # grade yet they add nothing; the graded plan course still counts.
    transcript = [course("0201301", grade), course(BASIC_ENGLISH, grade, credit_hours=4),
                  course("0201302", "D+")]
    assert checks.calculate_completed_hours(transcript) == 3
    total, matched = checks.calculate_program_applicable_hours(transcript, PLAN_COURSES)
    assert total == 3 and [c["course_id"] for c in matched] == ["0201302"]

    result = checks.run_basic_checks(program_change_request(transcript, cgpa=2.5), PLAN_COURSES)
    assert result["completed_hours"] == 3 and result["applicable_hours"] == 3
    assert [c["course_id"] for c in result["matched_courses"]] == ["0201302"]
    assert result["applicable_hours_eligible"] is False


def test_only_courses_in_progress_give_zero_hours():
    transcript = [course("0201301", None), course(BASIC_ENGLISH, None)]
    result = checks.run_basic_checks(program_change_request(transcript, cgpa=3.0), PLAN_COURSES)
    assert result["completed_hours"] == 0 and result["applicable_hours"] == 0
    assert result["matched_courses"] == []
    assert result["applicable_hours_eligible"] is False and result["cgpa_eligible"] is True


def test_a_course_in_progress_does_not_hide_a_bad_grade():
    with pytest.raises(ValueError, match="Unknown grade: WF"):
        checks.calculate_completed_hours([course("A1", None), course("A2", "WF")])

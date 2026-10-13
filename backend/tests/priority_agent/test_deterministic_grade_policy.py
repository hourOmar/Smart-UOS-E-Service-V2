import pytest

from app.agents.raise_capacity_priority.deterministic.grade_policy import classify_grade

PASSING_GRADES = ["A", "B+", "B", "C+", "C", "D+", "D"]
FAILING_GRADES = ["F", "WF", "FA"]


@pytest.mark.parametrize("grade", PASSING_GRADES)
def test_each_passing_grade_classified_passing(grade):
    assert classify_grade(grade) == "PASSING"


@pytest.mark.parametrize("grade", FAILING_GRADES)
def test_each_failing_grade_classified_failing(grade):
    assert classify_grade(grade) == "FAILING"


def test_null_grade_is_missing_not_guessed():
    assert classify_grade(None) == "MISSING"


def test_unknown_grade_is_unrecognized_not_guessed():
    assert classify_grade("IP") == "UNRECOGNIZED"
    assert classify_grade("Z") == "UNRECOGNIZED"

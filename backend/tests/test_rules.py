import json
from pathlib import Path

import pytest

from app.agents.raise_capacity_eligibility.tools import grade_policy
from app.agents.raise_capacity_eligibility.tools.capacity import evaluate_capacity
from app.agents.raise_capacity_eligibility.tools.completed_hours import (
    evaluate_completed_hours,
    get_completed_hours_requirement,
    normalize_course_id,
)

KB = Path(__file__).resolve().parent.parent / "app" / "agents" / "raise_capacity_eligibility" / "knowledge_base"


def test_knowledge_files_hold_the_approved_rules():
    policy = json.loads((KB / "grade_policy.json").read_text(encoding="utf-8"))
    assert policy["passing_grades"] == ["A", "B+", "B", "C+", "C", "D+", "D"]
    assert policy["failing_grades"] == ["F", "WF", "FA"]
    assert policy["status"] == "approved"
    hours = json.loads((KB / "course_completed_hours.json").read_text(encoding="utf-8"))
    assert {(c["course_id"], c["minimum_completed_hours"]) for c in hours["courses"]} == {
        (1501279, 31),
        (1501394, 65),
    }


@pytest.mark.parametrize("value", ["1501279", 1501279, " 1501279 "])
def test_course_id_normalization(value):
    assert normalize_course_id(value) == "1501279"


def test_completed_hours_rule_found_for_text_course_id_from_the_database():
    # The prototype compared '1501279' with 1501279 and never found the rule.
    requirement = get_completed_hours_requirement("1501279")
    assert requirement["found"] is True
    assert requirement["minimum_completed_hours"] == 31


def test_completed_hours_satisfied_and_not_satisfied():
    requirement = get_completed_hours_requirement("1501279")
    assert evaluate_completed_hours(31, requirement)["satisfied"] is True
    assert evaluate_completed_hours(30, requirement)["satisfied"] is False


def test_course_without_rule_is_not_applicable():
    result = evaluate_completed_hours(10, get_completed_hours_requirement("1501211"))
    assert result["applicable"] is False
    assert result["satisfied"] is None


def test_missing_completed_hours_is_unresolved_not_a_failure():
    result = evaluate_completed_hours(None, get_completed_hours_requirement("1501279"))
    assert result["applicable"] is True
    assert result["verified"] is False
    assert result["satisfied"] is None


def test_capacity_arithmetic():
    result = evaluate_capacity({"Current_Capacity": 30, "Total_Capacity": 30, "Additional_Capacity": 5})
    assert result["maximum_allowed_capacity"] == 35
    assert result["remaining_raise_capacity"] == 5
    assert result["satisfied"] is True
    full = evaluate_capacity({"Current_Capacity": 35, "Total_Capacity": 30, "Additional_Capacity": 5})
    assert full["satisfied"] is False


def test_grade_classification():
    assert grade_policy.classify_grade("b+") is True
    assert grade_policy.classify_grade("F") is False
    assert grade_policy.classify_grade(None) is False
    assert grade_policy.classify_grade("I") is None

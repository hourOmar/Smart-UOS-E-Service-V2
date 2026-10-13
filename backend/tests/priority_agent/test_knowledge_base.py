"""
Foundation test: confirms the local knowledge base was split into
course_offerings.json and prioritization_rules.json without losing or
altering the source data's shape.
"""

import json
from pathlib import Path

KB_DIR = (
    Path(__file__).resolve().parents[2]
    / "app"
    / "agents"
    / "raise_capacity_priority"
    / "knowledge"
    / "raise_capacity"
)


def test_course_offerings_has_expected_categories():
    data = json.loads((KB_DIR / "course_offerings.json").read_text())
    expected_categories = {
        "university_compulsory_courses",
        "college_compulsory_courses",
        "major_compulsory_courses",
        "support_compulsory_courses",
        "major_elective_courses",
    }
    assert expected_categories.issubset(data.keys())


def test_prioritization_rules_has_eight_rules_and_three_levels():
    data = json.loads((KB_DIR / "prioritization_rules.json").read_text())
    assert len(data["raise_capacity_prioritization_rules"]) == 8
    assert set(data["priority_levels"].keys()) == {"High", "Medium", "Low"}


def test_previous_attempts_rule_documents_the_intended_policy():
    data = json.loads((KB_DIR / "prioritization_rules.json").read_text())
    rules = data["raise_capacity_prioritization_rules"]
    matches = [rule for rule in rules if rule["name"] == "Previous Attempts"]
    assert len(matches) == 1

    rule = matches[0]
    description = rule["description"]
    assert "never attempted" in description
    assert "regardless of how many times" in description
    assert "grade or outcome" in description
    assert "must not by itself determine" in description

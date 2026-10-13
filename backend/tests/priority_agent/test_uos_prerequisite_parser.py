"""
Unit tests for the raw-text prerequisite parser. Pure text in, structured
tree out — no HTML, no network involved.
"""

from app.agents.raise_capacity_priority.retrieval.uos_prerequisite_parser import (
    find_course_reference_occurrences,
    parse_prerequisite_text,
)


def test_no_prerequisite_none_text():
    parsed = parse_prerequisite_text("None", "DEGREE_REQUIREMENTS")
    assert parsed.expression is None
    assert parsed.parseable is True
    assert parsed.relation == "PREREQUISITE"


def test_no_prerequisite_dash_text():
    parsed = parse_prerequisite_text("-", "STUDY_PLAN")
    assert parsed.expression is None
    assert parsed.parseable is True


def test_single_course_prerequisite():
    parsed = parse_prerequisite_text("1501211", "DEGREE_REQUIREMENTS")
    assert parsed.expression.kind == "COURSE"
    assert parsed.expression.course_id == 1501211


def test_and_prerequisite_comma():
    parsed = parse_prerequisite_text("1501215, 1501279", "DEGREE_REQUIREMENTS")
    assert parsed.expression.kind == "GROUP"
    assert parsed.expression.operator == "AND"
    ids = {item.course_id for item in parsed.expression.items}
    assert ids == {1501215, 1501279}


def test_and_prerequisite_semicolon_same_meaning_as_comma():
    comma = parse_prerequisite_text("1501215, 1501279", "DEGREE_REQUIREMENTS")
    semicolon = parse_prerequisite_text("1501215; 1501279", "STUDY_PLAN")
    comma_ids = {item.course_id for item in comma.expression.items}
    semicolon_ids = {item.course_id for item in semicolon.expression.items}
    assert comma.expression.operator == semicolon.expression.operator == "AND"
    assert comma_ids == semicolon_ids


def test_or_prerequisite():
    parsed = parse_prerequisite_text("1501211 or 1501341", "DEGREE_REQUIREMENTS")
    assert parsed.expression.operator == "OR"
    ids = {item.course_id for item in parsed.expression.items}
    assert ids == {1501211, 1501341}


def test_nested_and_or_prerequisite():
    parsed = parse_prerequisite_text("1501341, (1501246 or 1501247)", "DEGREE_REQUIREMENTS")
    assert parsed.expression.operator == "AND"
    assert len(parsed.expression.items) == 2
    course_item = next(i for i in parsed.expression.items if i.kind == "COURSE")
    group_item = next(i for i in parsed.expression.items if i.kind == "GROUP")
    assert course_item.course_id == 1501341
    assert group_item.operator == "OR"
    assert {i.course_id for i in group_item.items} == {1501246, 1501247}


def test_pre_or_co_relation():
    parsed = parse_prerequisite_text("Pre/Co: 1430110", "DEGREE_REQUIREMENTS")
    assert parsed.relation == "PRE_OR_CO"
    assert parsed.expression.course_id == 1430110


def test_pre_or_co_with_or_group():
    parsed = parse_prerequisite_text("Pre/Co: 1430110 or 1430115", "STUDY_PLAN")
    assert parsed.relation == "PRE_OR_CO"
    assert parsed.expression.operator == "OR"


def test_standing_requirement_only():
    parsed = parse_prerequisite_text("Junior/Senior standing", "DEGREE_REQUIREMENTS")
    assert parsed.expression.kind == "STANDING"
    assert parsed.expression.text == "Junior/Senior standing"


def test_course_and_standing_requirement():
    parsed = parse_prerequisite_text("1501215 and Junior Standing", "DEGREE_REQUIREMENTS")
    assert parsed.expression.operator == "AND"
    kinds = {item.kind for item in parsed.expression.items}
    assert kinds == {"COURSE", "STANDING"}
    course_item = next(i for i in parsed.expression.items if i.kind == "COURSE")
    standing_item = next(i for i in parsed.expression.items if i.kind == "STANDING")
    assert course_item.course_id == 1501215
    assert standing_item.text == "Junior Standing"


def test_prerequisite_label_prefix_is_stripped():
    parsed = parse_prerequisite_text(
        "Prerequisite: 1501116 Programming I", "COURSE_DESCRIPTION"
    )
    assert parsed.expression.course_id == 1501116


def test_perquisite_typo_label_prefix_is_stripped():
    parsed = parse_prerequisite_text("Perquisite: None", "COURSE_DESCRIPTION")
    assert parsed.expression is None
    assert parsed.parseable is True


def test_find_course_reference_and_required_occurrence():
    parsed = parse_prerequisite_text("1501215, 1501279", "DEGREE_REQUIREMENTS")
    occurrences = find_course_reference_occurrences(parsed.expression, 1501215)
    assert occurrences == [True]


def test_find_course_reference_or_alternative_occurrence():
    parsed = parse_prerequisite_text("1501211 or 1501341", "DEGREE_REQUIREMENTS")
    occurrences = find_course_reference_occurrences(parsed.expression, 1501211)
    assert occurrences == [False]


def test_find_course_reference_not_present():
    parsed = parse_prerequisite_text("1501211", "DEGREE_REQUIREMENTS")
    occurrences = find_course_reference_occurrences(parsed.expression, 9999999)
    assert occurrences == []

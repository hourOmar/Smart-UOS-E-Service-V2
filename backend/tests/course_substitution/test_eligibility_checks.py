"""eligibility_checks.py: the term rule, checks 1, 2, 4 and 5, a knowledge base
that cannot be loaded, and the overall-result rule (contract sections 3-5)."""

import datetime as dt

import pytest

from app.agents.course_substitution_eligibility import eligibility_checks as ec

from .fakes import ETHICS, INFO_SECURITY, OOD_JAVA, PROGRAMMING_I, REQUEST_ID, freeze_today, make_request

CHECK_1 = "Original course unavailable before graduation"
CHECK_2 = "Proposed course is at the same level or higher"
CHECK_3 = "Original course is a core course"
CHECK_4 = "Proposed course is offered in the current semester"
CHECK_5 = "Proposed course has not been completed previously"


def kb(fall="NO", spring="NO", summer="NO", course_id="1501999", name="Synthetic Course"):
    return {course_id: {"course_id": course_id, "course_name": name,
                        "offerings": {"Fall": fall, "Spring": spring, "Summer": summer}}}


def check_1(courses, current_term, graduation, course_id="1501999"):
    return ec.check_original_course_unavailable(
        {"course_id": course_id}, {"expected_graduation_term": graduation}, courses, current_term)


# --- term rule ------------------------------------------------------------------

@pytest.mark.parametrize("day, term", [
    (dt.date(2026, 8, 1), 202601), (dt.date(2026, 12, 31), 202601),
    (dt.date(2027, 1, 1), 202602), (dt.date(2027, 5, 31), 202602),
    (dt.date(2026, 6, 1), None), (dt.date(2026, 7, 31), None),
])
def test_month_table(day, term):
    assert ec.get_current_term(day) == term
    assert ec.get_current_term(dt.datetime(day.year, day.month, day.day, 23, 0)) == term


def test_today_is_the_dubai_date(monkeypatch):
    freeze_today(monkeypatch, dt.date(2026, 11, 11))
    assert ec.get_current_term() == 202601
    freeze_today(monkeypatch, dt.date(2026, 6, 15))
    assert ec.get_current_term() is None


def test_today_must_be_a_date():
    with pytest.raises(ValueError):
        ec.get_current_term("2026-11-11")


def test_term_arithmetic_and_invalid_terms():
    assert ec.next_term(202601) == 202602
    assert ec.next_term(202602) == 202701
    assert ec.next_term("202602") == 202701
    assert ec.term_order(202602) == ec.term_order(202601) + 1 == ec.term_order(202701) - 1
    assert ec.term_to_semester(202601) == "Fall" and ec.term_to_semester(202602) == "Spring"
    for bad in (2026, 202603, "abc", None, "", 2026010):
        assert ec.next_term(bad) is None
        assert ec.term_order(bad) is None
        assert ec.term_to_semester(bad) is None


# --- knowledge base -------------------------------------------------------------

def test_knowledge_base_format(tmp_path):
    path = tmp_path / "kb.txt"
    path.write_text(
        "| Course ID | Course Name | Fall | Spring | Summer |\n"
        "|---|---|---|---|---|\n"
        "| 1501001 | Valid Course | yes | No | maybe |\n"
        "| 150100 | Six Digits | Yes | Yes | Yes |\n"
        "| 1501002 | Too Few | Yes | Yes |\n"
        "not a table row\n",
        encoding="utf-8",
    )
    courses = ec.load_course_knowledge_base(path)
    assert courses == {"1501001": {"course_id": "1501001", "course_name": "Valid Course",
                                   "offerings": {"Fall": "YES", "Spring": "NO", "Summer": "UNKNOWN"}}}


def test_real_knowledge_base_rows_used_by_the_examples():
    courses = ec.load_course_knowledge_base()
    assert courses[OOD_JAVA[0]]["offerings"] == {"Fall": "NO", "Spring": "YES", "Summer": "NO"}
    assert courses[INFO_SECURITY[0]]["offerings"]["Fall"] == "YES"
    assert courses[ETHICS[0]]["offerings"] == {"Fall": "YES", "Spring": "NO", "Summer": "NO"}
    assert courses[PROGRAMMING_I[0]]["offerings"]["Spring"] == "YES"


# --- check 1 --------------------------------------------------------------------

def test_check_1_requires_review_rows_in_order():
    assert check_1(kb(), 202601, 202602, course_id="15019")["evidence"] == "The original course ID is missing or invalid."
    assert check_1({}, 202601, 202602)["evidence"] == "Course 1501999 is missing from the offerings knowledge base."
    assert check_1(kb(), None, 202602)["evidence"] == "The current academic term could not be determined."
    assert check_1(kb(), 202601, "2026")["evidence"] == "The expected graduation term is missing or invalid."
    assert check_1(kb(), 202601, None)["evidence"] == "The expected graduation term is missing or invalid."
    assert check_1(kb(), 202602, 202601)["evidence"] == (
        "The expected graduation term is earlier than the current academic term.")
    for row in (check_1(kb(), 202601, 202602, course_id=""), check_1(kb(), None, None)):
        assert row["condition"] == CHECK_1 and row["status"] == "REQUIRES_REVIEW"


def test_check_1_pass_when_never_offered_through_graduation():
    result = check_1(kb(), 202601, 202701)
    assert result == {"condition": CHECK_1, "status": "PASS", "evidence": (
        "Synthetic Course is not offered in any remaining semester through graduation. "
        "Checked: Fall (202601): NO, Spring (202602): NO, Summer after 202602: NO, Fall (202701): NO.")}


def test_check_1_fail_on_a_remaining_semester_stops_the_walk():
    result = check_1(kb(spring="YES", fall="NO"), 202601, 202701)
    assert result["status"] == "FAIL"
    assert result["evidence"] == ("Synthetic Course is offered in a remaining Spring semester. "
                                  "Checked: Fall (202601): NO, Spring (202602): YES.")


def test_check_1_unknown_semester_stops_the_walk():
    result = check_1(kb(fall="UNKNOWN", spring="YES"), 202601, 202701)
    assert result["status"] == "REQUIRES_REVIEW"
    assert result["evidence"] == ("The offering status for Synthetic Course is unknown in Fall. "
                                  "Checked: Fall (202601): UNKNOWN.")


def test_check_1_summer_yes_before_graduation_fails():
    result = check_1(kb(summer="YES"), 202602, 202701)
    assert result["status"] == "FAIL"
    assert result["evidence"] == "Synthetic Course is offered in Summer before the expected graduation semester."


def test_check_1_summer_unknown_requires_review():
    result = check_1(kb(summer="UNKNOWN"), 202602, 202701)
    assert result == {"condition": CHECK_1, "status": "REQUIRES_REVIEW",
                      "evidence": "The Summer offering status is unknown."}


def test_check_1_summer_only_after_a_spring_before_graduation():
    # Graduation in Spring: the Summer after it is never looked at.
    result = check_1(kb(summer="YES"), 202602, 202602)
    assert result["status"] == "PASS"
    assert "Summer" not in result["evidence"]
    # A Fall term is never followed by a Summer check.
    result = check_1(kb(summer="YES"), 202601, 202601)
    assert result["status"] == "PASS"
    assert result["evidence"].endswith("Checked: Fall (202601): NO.")


def test_check_1_graduation_term_as_text_or_int():
    assert check_1(kb(), 202601, "202601") == check_1(kb(), 202601, 202601)


# --- check 2 --------------------------------------------------------------------

def level(original, proposed):
    return ec.check_course_level({"course_id": original}, {"course_id": proposed})


def test_check_2_uses_the_fifth_digit_and_last_two_digits():
    assert level("1501454", "1501459") == {"condition": CHECK_2, "status": "PASS",
                                           "evidence": "Original year/level: 4/54; proposed year/level: 4/59."}
    assert level("1501459", "1501454")["status"] == "FAIL"
    assert level("1501459", "1501454")["evidence"] == (
        "Original year/level: 4/59; proposed year/level: 4/54. The proposed course is lower under the defined rule.")
    assert level("1501459", "1501459")["status"] == "PASS"
    assert level("1501399", "0201401")["status"] == "PASS"   # higher year; department prefix ignored
    assert level("1501301", "1501299")["status"] == "FAIL"   # lower year, higher level


@pytest.mark.parametrize("original, proposed", [("150145", "1501459"), ("1501459", ""), (None, None),
                                                ("15014a9", "1501459")])
def test_check_2_invalid_ids(original, proposed):
    assert level(original, proposed) == {"condition": CHECK_2, "status": "REQUIRES_REVIEW",
                                         "evidence": "One or both course IDs are missing or invalid."}


# --- check 4 --------------------------------------------------------------------

def offering(courses, term, course_id="1501999"):
    return ec.check_proposed_course_offering({"course_id": course_id}, courses, term)


def test_check_4_rows():
    assert offering(kb(), 202601, course_id="x")["evidence"] == "The proposed course ID is missing or invalid."
    assert offering({}, 202601)["evidence"] == "Course 1501999 is missing from the offerings knowledge base."
    assert offering(kb(), None)["evidence"] == "The current Fall/Spring semester could not be determined."
    assert offering(kb(fall="YES"), 202601) == {"condition": CHECK_4, "status": "PASS",
                                                "evidence": "Synthetic Course is listed as offered in Fall."}
    assert offering(kb(spring="NO"), 202602) == {"condition": CHECK_4, "status": "FAIL",
                                                 "evidence": "Synthetic Course is listed as not offered in Spring."}
    assert offering(kb(fall="UNKNOWN"), 202601) == {
        "condition": CHECK_4, "status": "REQUIRES_REVIEW",
        "evidence": "The knowledge base does not specify whether Synthetic Course is offered in Fall."}


def test_check_4_uses_the_knowledge_base_name_not_the_database_name():
    result = ec.check_proposed_course_offering({"course_id": "1501999", "course_name": "DB name"}, kb(fall="YES"), 202601)
    assert "Synthetic Course" in result["evidence"] and "DB name" not in result["evidence"]


# --- check 5 --------------------------------------------------------------------

def completion(value, course_id="1501459"):
    return ec.check_proposed_course_not_completed({"course_id": course_id}, value)


def test_check_5_rows():
    assert completion({"proposed_course_completed": False}, course_id="")["evidence"] == (
        "The proposed course ID is missing or invalid.")
    for missing in (None, {}, {"original_course_completed": True}, "yes"):
        assert completion(missing)["evidence"] == "The student's course-completion information is unavailable."
    assert completion({"proposed_course_completed": True}) == {
        "condition": CHECK_5, "status": "FAIL",
        "evidence": "Course 1501459 has previously been completed with a passing grade."}
    assert completion({"proposed_course_completed": False}) == {
        "condition": CHECK_5, "status": "PASS",
        "evidence": "Course 1501459 has not been completed with a passing grade."}
    for other in (None, 1, "true"):
        assert completion({"proposed_course_completed": other}) == {
            "condition": CHECK_5, "status": "REQUIRES_REVIEW",
            "evidence": "The student's course-completion status could not be determined."}


# --- deterministic checks and overall result ------------------------------------

def statuses(result):
    return [c["status"] for c in result["checks"]]


def test_deterministic_checks_keep_order_with_a_check_3_placeholder():
    result = ec.evaluate_deterministic_checks(make_request(), current_date=dt.date(2026, 11, 11))
    assert [c["condition"] for c in result["checks"]] == [CHECK_1, CHECK_2, CHECK_3, CHECK_4, CHECK_5]
    assert result["checks"][2] == {"condition": CHECK_3, "status": "REQUIRES_REVIEW",
                                   "evidence": "Awaiting verification against the official program study plan."}
    assert statuses(result) == ["PASS", "PASS", "REQUIRES_REVIEW", "PASS", "PASS"]


def test_knowledge_base_load_failure_only_affects_checks_1_and_4(tmp_path):
    missing = tmp_path / "missing.txt"
    result = ec.evaluate_deterministic_checks(
        make_request(proposed=("1501116", "Programming I"), completed=True),
        current_date=dt.date(2026, 11, 11), knowledge_base_path=missing)
    error = f"Could not load course offerings knowledge base: Course offerings knowledge base not found: {missing}"
    assert result["checks"][0] == {"condition": CHECK_1, "status": "REQUIRES_REVIEW", "evidence": error}
    assert result["checks"][3] == {"condition": CHECK_4, "status": "REQUIRES_REVIEW", "evidence": error}
    assert result["checks"][1]["status"] == "FAIL"            # 2/46 -> 1/16, still evaluated
    assert result["checks"][4]["status"] == "FAIL"            # completed, still evaluated
    assert result["overall_result"] == "NOT_ELIGIBLE"


def test_undecodable_knowledge_base_is_a_load_failure(tmp_path):
    bad = tmp_path / "bad.txt"
    bad.write_bytes(b"\xff\xfe\xfa not utf-8")
    result = ec.evaluate_deterministic_checks(make_request(), current_date=dt.date(2026, 11, 11),
                                              knowledge_base_path=bad)
    assert result["checks"][0]["evidence"].startswith("Could not load course offerings knowledge base: ")


def test_request_must_be_a_dict():
    with pytest.raises(ValueError):
        ec.evaluate_deterministic_checks(None)


def make_checks(*statuses_):
    return [{"condition": f"c{i}", "status": s, "evidence": ""} for i, s in enumerate(statuses_)]


@pytest.mark.parametrize("checks, overall", [
    (make_checks("PASS", "PASS", "PASS", "PASS", "PASS"), "ELIGIBLE"),
    (make_checks("PASS", "FAIL", "PASS", "PASS", "PASS"), "NOT_ELIGIBLE"),
    (make_checks("REQUIRES_REVIEW", "FAIL", "REQUIRES_REVIEW"), "NOT_ELIGIBLE"),   # FAIL beats REQUIRES_REVIEW
    (make_checks("PASS", "REQUIRES_REVIEW", "PASS"), "MANUAL_REVIEW"),
    ([], "MANUAL_REVIEW"),
])
def test_overall_result_rule(checks, overall):
    result = ec.build_overall_result({"request_id": REQUEST_ID}, 202602, checks)
    assert result == {"request_id": REQUEST_ID, "current_term": 202602, "current_semester": "Spring",
                      "overall_result": overall, "checks": checks}


def test_overall_result_without_a_current_term():
    result = ec.build_overall_result({"request_id": REQUEST_ID}, None, make_checks("PASS"))
    assert result["current_term"] is None and result["current_semester"] is None

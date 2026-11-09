"""The deterministic checks (policy_checks.py = the standalone exam_policy_tools.py)
against the real, unchanged policy file."""

import datetime as dt

from app.agents.incomplete_exam.policy_checks import evaluate_incomplete_exam_request, get_incomplete_exam_policy


def a_sunday():
    day = dt.date(2026, 11, 1)
    while day.weekday() != 6:
        day += dt.timedelta(days=1)
    return day


def request(missed, filed, **extra):
    base = {"Missed_Exam_Date": missed, "Request_Date": filed, "Proof": "Medical report", "Exam_Type": "Midterm",
            "Description": "Hospitalised.", "Reason": "Fallback reason."}
    base.update(extra)
    return base


def window(missed, filed):
    return evaluate_incomplete_exam_request(request(missed, filed), get_incomplete_exam_policy())["submission_window"]


def test_policy_values_are_the_approved_ones():
    policy = get_incomplete_exam_policy()
    assert policy["submission_window"]["limit_working_days"] == 4
    assert policy["submission_window"]["weekend_days"] == ["Friday", "Saturday"]
    assert policy["proof_required"] is True
    assert policy["excluded_exam_types"]["values"] == [] and policy["excluded_exam_types"]["status"] == "confirmed"


def test_working_days_skip_friday_and_saturday():
    sunday = a_sunday()
    assert window(sunday, sunday)["working_days_elapsed"] == 0
    thursday = window(sunday, sunday + dt.timedelta(days=4))
    assert thursday["working_days_elapsed"] == 4 and thursday["satisfied"] is True
    saturday = window(sunday, sunday + dt.timedelta(days=6))     # Friday and Saturday not counted
    assert saturday["working_days_elapsed"] == 4 and saturday["satisfied"] is True
    next_sunday = window(sunday, sunday + dt.timedelta(days=7))
    assert next_sunday["working_days_elapsed"] == 5 and next_sunday["satisfied"] is False
    assert next_sunday["holiday_calendar_checked"] is False and next_sunday["limit_working_days"] == 4


def test_dates_accept_iso_strings():
    result = window("2026-11-01", "2026-11-02")
    assert result["missed_exam_date"] == "2026-11-01" and result["request_date"] == "2026-11-02"


def test_proof_provided_follows_the_text_column():
    policy = get_incomplete_exam_policy()
    sunday = a_sunday()
    assert evaluate_incomplete_exam_request(request(sunday, sunday), policy)["proof"] == {
        "required": True, "provided": True, "raw_value": "Medical report"}
    blank = evaluate_incomplete_exam_request(request(sunday, sunday, Proof="   "), policy)["proof"]
    assert blank == {"required": True, "provided": False, "raw_value": None}


def test_exam_type_confirmed_with_no_exclusions():
    out = evaluate_incomplete_exam_request(request(a_sunday(), a_sunday()), get_incomplete_exam_policy())
    assert out["exam_type"] == {"value": "Midterm", "excluded_values_confirmed": True, "excluded": False}


def test_reason_prefers_description_then_reason():
    policy = get_incomplete_exam_policy()
    sunday = a_sunday()
    assert evaluate_incomplete_exam_request(request(sunday, sunday), policy)["reason_for_gemini_review"] == "Hospitalised."
    out = evaluate_incomplete_exam_request(request(sunday, sunday, Description=None), policy)
    assert out["reason_for_gemini_review"] == "Fallback reason."
    assert out["acceptable_proof_categories"] == policy["acceptable_proof_categories"]
    assert out["explicitly_invalid_reasons"] == policy["explicitly_invalid_reasons"]

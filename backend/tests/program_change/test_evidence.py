"""Shaikha's evidence building (evidence.py, logic unchanged): catalog lookup by
Program ID AND name, the study-plan extraction prompt and its validation, and
the evidence package. Gemini and the database are replaced by fakes."""

import json

import pytest

from app.agents.program_change_eligibility import evidence
from app.agents.program_change_eligibility.llm_client import GeminiResponse

from .fakes import (
    OTHER_PROGRAM_SAME_ID, PLAN_COURSES, REQUESTED_PROGRAM, STUDY_PLAN_REPLY, approve_transcript,
    program_change_request,
)


@pytest.fixture
def fake_study_plan(monkeypatch):
    calls = []

    def install(*replies):
        replies = list(replies)

        def generate(prompt, use_url_context=False):
            calls.append({"prompt": prompt, "use_url_context": use_url_context})
            return GeminiResponse(text=replies.pop(0), model="fake-model")

        monkeypatch.setattr(evidence, "generate_with_fallback", generate)
        return calls
    return install


# -- catalog -----------------------------------------------------------------------

def test_catalog_match_needs_both_id_and_name():
    wanted = evidence.get_program_url(REQUESTED_PROGRAM["program_id"], REQUESTED_PROGRAM["program_name"])
    other = evidence.get_program_url(REQUESTED_PROGRAM["program_id"], OTHER_PROGRAM_SAME_ID)
    assert wanted["program_name"] == REQUESTED_PROGRAM["program_name"]
    assert wanted["official_url"].startswith("https://www.sharjah.ac.ae/")
    assert other["official_url"] != wanted["official_url"]


def test_catalog_name_comparison_ignores_degree_prefix_and_case():
    plain = evidence.get_program_url("0201", "ARABIC LANGUAGE AND LITERATURE")
    assert plain["program_name"] == REQUESTED_PROGRAM["program_name"]


@pytest.mark.parametrize("program_id, name", [("0201", "Unknown Program"), ("9999", REQUESTED_PROGRAM["program_name"])])
def test_no_catalog_match_is_an_error(program_id, name):
    with pytest.raises(ValueError, match="found 0"):
        evidence.get_program_url(program_id, name)


# -- study plan (Gemini call 1) ----------------------------------------------------------

def test_study_plan_prompt_and_url_context(fake_study_plan):
    calls = fake_study_plan(STUDY_PLAN_REPLY)
    plan = evidence.get_program_webpage("https://example.test/plan", REQUESTED_PROGRAM["program_name"])
    assert calls[0]["use_url_context"] is True
    assert "https://example.test/plan" in calls[0]["prompt"]
    assert "NEVER change, correct, normalize, add, remove, or" in calls[0]["prompt"]
    assert plan == {"url": "https://example.test/plan", "program_name": REQUESTED_PROGRAM["program_name"],
                    "courses": PLAN_COURSES}


def test_study_plan_code_fences_are_removed(fake_study_plan):
    fake_study_plan(f"```json\n{STUDY_PLAN_REPLY}\n```")
    plan = evidence.get_program_webpage("u", REQUESTED_PROGRAM["program_name"])
    assert len(plan["courses"]) == len(PLAN_COURSES)


def test_invalid_courses_are_dropped(fake_study_plan):
    fake_study_plan(json.dumps({"program_name": REQUESTED_PROGRAM["program_name"], "courses": [
        {"course_id": "0201301", "course_name": "Kept", "credit_hours": "3"},
        {"course_id": "", "course_name": "No ID", "credit_hours": 3},
        {"course_id": "0201302", "course_name": "No credits"},
        {"course_id": "0201303", "course_name": "Bad credits", "credit_hours": "three"},
        "not a course",
    ]}))
    plan = evidence.get_program_webpage("u", REQUESTED_PROGRAM["program_name"])
    assert plan["courses"] == [{"course_id": "0201301", "course_name": "Kept", "credit_hours": 3}]


@pytest.mark.parametrize("reply, message", [
    ("", "empty study-plan content"),
    ("not json", "invalid JSON"),
    ("[]", "Invalid study-plan structure"),
    (json.dumps({"program_name": "", "courses": []}), "did not identify the program name"),
    (json.dumps({"program_name": OTHER_PROGRAM_SAME_ID, "courses": PLAN_COURSES}), "Program mismatch"),
    (json.dumps({"program_name": REQUESTED_PROGRAM["program_name"], "courses": {}}), "valid 'courses' list"),
    (json.dumps({"program_name": REQUESTED_PROGRAM["program_name"], "courses": []}), "No valid courses"),
])
def test_unusable_study_plans_are_errors(fake_study_plan, reply, message):
    fake_study_plan(reply)
    with pytest.raises(ValueError, match=message):
        evidence.get_program_webpage("u", REQUESTED_PROGRAM["program_name"])


# -- evidence package -----------------------------------------------------------------

def test_evidence_package(monkeypatch, fake_study_plan):
    request = program_change_request(approve_transcript())
    monkeypatch.setattr(evidence, "get_program_change_request", lambda rid: request)
    fake_study_plan(STUDY_PLAN_REPLY)
    package = evidence.build_evidence_package("STUD_TEST_000001")
    assert package["request"] == request
    assert package["current_program"] == request["current_program"]
    assert package["requested_program"]["program_id"] == REQUESTED_PROGRAM["program_id"]
    assert package["requested_program"]["study_plan_source"]["courses"] == PLAN_COURSES
    assert package["transcript"] == request["transcript"]
    assert "15 credit hours" in package["program_change_constraints"]
    assert "Basic English" in package["university_courses"]
    assert [s["type"] for s in package["sources"]] == [
        "program_catalog", "program_change_rules", "university_courses", "requested_program_webpage"]


@pytest.mark.parametrize("shape", ["list", "outer_key"])
def test_evidence_accepts_the_rpc_reply_variants(monkeypatch, fake_study_plan, shape):
    request = program_change_request(approve_transcript())
    data = [request] if shape == "list" else {"get_program_change_request": request}
    monkeypatch.setattr(evidence, "get_program_change_request", lambda rid: data)
    fake_study_plan(STUDY_PLAN_REPLY)
    assert evidence.build_evidence_package("STUD_TEST_000001")["request"] == request


def test_missing_request_is_an_error(monkeypatch):
    monkeypatch.setattr(evidence, "get_program_change_request", lambda rid: None)
    with pytest.raises(ValueError, match="No Program Change request found"):
        evidence.build_evidence_package("STUD_TEST_000001")


def test_other_request_type_is_an_error(monkeypatch):
    request = {**program_change_request([]), "request_type": "Raise Capacity"}
    monkeypatch.setattr(evidence, "get_program_change_request", lambda rid: request)
    with pytest.raises(ValueError, match="is not a Program Change request"):
        evidence.build_evidence_package("STUD_TEST_000001")

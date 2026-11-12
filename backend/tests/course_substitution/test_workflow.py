"""workflow.evaluate_course_substitution_request: the result, the rejection only
for NOT_ELIGIBLE, the evidence snapshot with fingerprints, the answering models
and the missing-key failure (contract sections 8-9)."""

import datetime as dt
import json

import pytest

from app.agents.course_substitution_eligibility import workflow
from app.agents.course_substitution_eligibility.exceptions import CourseSubstitutionDetailsMissingError
from app.core.gemini import GeminiUnavailableError

from .fakes import (
    ETHICS, INFO_SECURITY, OOD_JAVA, PROGRAMMING_I, REQUEST_ID, STUDENT_ID, api_error, db_rows, freeze_today,
    install_fake_database, install_fake_gemini, rejection_reply, study_plan_reply,
)

FINGERPRINTS = [
    {"file": "data/course_offerings_knowledge_base.txt",
     "sha256": "c00ea9f5a789ee9bda79b2bed944aa338688bde9dd38eb06aaf5d5800fcb5cfd"},
    {"file": "data/bachelors_program_catalog.txt",
     "sha256": "49324f1ea7f683af642845330201d469cec8683914a4023dcc633c1f724c52db"},
    {"file": "data/rejection_keywords.json",
     "sha256": "c16b99d46253901ddc47f54f52ebe32f883b7b46e065213edef279547ffb42ec"},
]


def test_eligible_outcome_and_evidence_snapshot(monkeypatch):
    freeze_today(monkeypatch, dt.date(2026, 11, 11))
    install_fake_database(monkeypatch, db_rows(original=OOD_JAVA, proposed=INFO_SECURITY))
    install_fake_gemini(monkeypatch, study_plan_reply())

    outcome = workflow.evaluate_course_substitution_request(REQUEST_ID)

    assert outcome.result["overall_result"] == "ELIGIBLE"
    assert (outcome.result["current_term"], outcome.result["current_semester"]) == (202601, "Fall")
    assert len(outcome.result["checks"]) == 5
    assert outcome.rejection is None
    assert (outcome.study_plan_model, outcome.rejection_model) == ("test-model", None)

    evidence = outcome.evidence
    assert set(evidence) == {"request", "knowledge_files", "collected_at"}
    assert evidence["knowledge_files"] == FINGERPRINTS
    assert dt.datetime.fromisoformat(evidence["collected_at"]).tzinfo is not None
    request = evidence["request"]
    assert request["request_id"] == REQUEST_ID and request["student"]["student_id"] == STUDENT_ID
    assert set(request["student"]) == {"student_id", "student_name", "program_id", "program_name",
                                       "expected_graduation_term"}
    for course in ("original_course", "proposed_course"):
        assert set(request[course]) == {"course_id", "course_name"}
    assert "email" not in json.dumps(evidence, default=str).lower()


def test_not_eligible_keeps_the_rejection_and_records_both_models(monkeypatch):
    freeze_today(monkeypatch, dt.date(2027, 2, 10))
    install_fake_database(monkeypatch, db_rows(original=ETHICS, proposed=PROGRAMMING_I, graduation=202701,
                                               completed=[PROGRAMMING_I[0]]))
    keywords = ["original_course_offered_before_graduation", "proposed_course_lower_level",
                "proposed_course_already_completed"]
    install_fake_gemini(monkeypatch, api_error(503), study_plan_reply(), json.dumps(rejection_reply(keywords)),
                        fallback_models="fb-1")

    outcome = workflow.evaluate_course_substitution_request(REQUEST_ID)

    assert outcome.result["overall_result"] == "NOT_ELIGIBLE"
    assert outcome.rejection["status"] == "gemini"
    assert outcome.study_plan_model == "fb-1"          # test-model was unavailable for the study plan call
    assert outcome.rejection_model == "test-model"


def test_failed_gemini_calls_record_no_model(monkeypatch):
    freeze_today(monkeypatch, dt.date(2027, 2, 10))
    install_fake_database(monkeypatch, db_rows(original=ETHICS, proposed=PROGRAMMING_I, graduation=202701))
    install_fake_gemini(monkeypatch, api_error(400), api_error(400))

    outcome = workflow.evaluate_course_substitution_request(REQUEST_ID)

    assert outcome.result["overall_result"] == "NOT_ELIGIBLE"
    assert outcome.rejection["status"] == "fallback"
    assert (outcome.study_plan_model, outcome.rejection_model) == (None, None)


def test_missing_gemini_key_fails_before_any_read_or_check(monkeypatch):
    conn = install_fake_database(monkeypatch, db_rows())
    models = install_fake_gemini(monkeypatch, key="")
    with pytest.raises(GeminiUnavailableError, match="GEMINI_API_KEY is not configured."):
        workflow.evaluate_course_substitution_request(REQUEST_ID)
    assert conn.queries == [] and models.calls == []


def test_request_level_errors_stop_before_gemini(monkeypatch):
    install_fake_database(monkeypatch, db_rows(Course_Substitution=None))
    models = install_fake_gemini(monkeypatch)
    with pytest.raises(CourseSubstitutionDetailsMissingError):
        workflow.evaluate_course_substitution_request(REQUEST_ID)
    assert models.calls == []

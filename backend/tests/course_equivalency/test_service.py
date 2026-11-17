"""Run management (service.py): first opening only for In Progress requests with details,
both syllabi and no runs; syllabi-missing and details-missing states; reruns; one run at a
time; interrupted runs; failure classification (never a recommendation); keeping the last
successful result; outdated results after a syllabus replacement; tokens never stored."""

import json

import pytest
from sqlalchemy.exc import OperationalError

from app.agents.course_equivalency import AGENT_VERSION, service, workflow
from app.agents.course_equivalency.exceptions import (
    CourseEquivalencyDetailsMissingError, NotCourseEquivalencyRequestError, RequestNotFoundError, RerunNotAllowedError,
    RunInProgressError, SyllabiMissingError, SyllabusIntegrityError,
)
from app.core import storage
from app.core.database import DatabaseUnavailableError
from app.core.gemini import GeminiUnavailableError

from .fakes import RID, SESSION, SID_NEW, SID_NEW2, SID_OLD, STAFF, TOKEN, FakeRepo, no_db


@pytest.fixture
def repo(monkeypatch):
    def install(**kwargs):
        fake = FakeRepo(**kwargs)
        monkeypatch.setattr(service, "repo", fake)
        monkeypatch.setattr(service, "read_only", no_db)
        monkeypatch.setattr(service, "write_transaction", no_db)
        return fake
    return install


@pytest.fixture
def agents(monkeypatch):
    def install(result):
        calls = []

        def fake(request_id, access_token):
            calls.append((request_id, access_token))
            if isinstance(result, BaseException):
                raise result
            return result
        monkeypatch.setattr(workflow, "run_course_equivalency_agents", fake)
        return calls
    return install


def refs(new=SID_NEW):
    return [{"syllabus_id": SID_OLD, "side": "old", "storage_path": f"{RID}/old/x.pdf", "file_name": "o.pdf",
             "mime_type": "application/pdf", "size_bytes": 10, "sha256": "a" * 64, "source": "legacy_import", "text_chars": 900},
            {"syllabus_id": new, "side": "new", "storage_path": f"{RID}/new/y.pdf", "file_name": "n.pdf",
             "mime_type": "application/pdf", "size_bytes": 11, "sha256": "b" * 64, "source": "staff_upload", "text_chars": 800}]


def outcome(recommendation="APPROVE", reasoning="Synthetic reasoning.", assessment_model="model-decision", new=SID_NEW):
    evidence = {"old_course": {"course_id": "1", "name": "Old", "credit_hours": 3, "in_catalog": True, "in_transcript": True,
                               "grade": "B", "grade_source": "transcript", "passed": True, "term": 202510},
                "new_course": {"course_id": "2", "name": "New", "credit_hours": 3, "in_catalog": True},
                "constraints": {"minimum_grade": {"meets": True}}, "academic_level": {"old_at_least_new": True},
                "syllabi": {}, "syllabus_request": None, "similarity": None, "text_overlap_percent": None}
    eligibility = {"request_id": RID, "evidence": evidence, "recommendation": recommendation, "reasoning": reasoning,
                   "checks": [{"name": "content_similarity", "status": "PASS", "explanation": "x"}]}
    rejection = ({"request_id": RID, "status": "fallback", "keywords": [], "suggested_reasons": [], "notes": []}
                 if recommendation == "REJECT" else {"request_id": RID, "status": "not_applicable", "keywords": [],
                                                     "suggested_reasons": [], "notes": []})
    return workflow.WorkflowOutcome(eligibility=eligibility, rejection=rejection, evidence={"collected_at": "now"},
                                    evaluated_syllabi=refs(new), assessment_model=assessment_model,
                                    rejection_model="model-rejection" if recommendation == "REJECT" else None)


def test_first_open_runs_and_stores_the_outcome(repo, agents):
    fake = repo()
    calls = agents(outcome())
    assert service.ensure_evaluation(RID, SESSION, rerun=False) == service.EnsureOutcome(True, False, "started")
    run = fake.runs[0]
    assert calls == [(RID, TOKEN)] and fake.locks == [RID]
    assert run["run_status"] == "completed" and run["run_trigger"] == "first_open" and run["agent_version"] == AGENT_VERSION
    assert run["recommendation"] == "APPROVE" and run["rejection_explanation"] is None and run["rejection_model"] is None
    assert run["triggered_by"] == STAFF.auth_user_id and run["triggered_by_staff_id"] == STAFF.staff_id
    assert [r["syllabus_id"] for r in run["evaluated_syllabi"]] == [SID_OLD, SID_NEW]
    assert run["deterministic_results"]["old_course"]["grade"] == "B"


def test_reject_stores_the_rejection_explanation_and_model(repo, agents):
    fake = repo()
    agents(outcome("REJECT"))
    service.ensure_evaluation(RID, SESSION, rerun=False)
    run = fake.runs[0]
    assert run["recommendation"] == "REJECT" and run["rejection_explanation"]["status"] == "fallback"
    assert run["rejection_model"] == "model-rejection"


def test_never_stores_the_token(repo, agents):
    fake = repo()
    agents(outcome())
    service.ensure_evaluation(RID, SESSION, rerun=False)
    assert TOKEN not in json.dumps(fake.runs, default=str)


@pytest.mark.parametrize("kwargs,reason", [
    ({"ready": False}, "syllabi_missing"),
    ({"details": False}, "details_missing"),
    ({"status": "Completed"}, "not_in_progress"),
    ({"status": "Rejected"}, "not_in_progress"),
])
def test_first_open_never_runs_without_the_preconditions(repo, agents, kwargs, reason):
    fake = repo(**kwargs)
    calls = agents(outcome())
    assert service.ensure_evaluation(RID, SESSION, rerun=False).reason == reason
    assert calls == [] and fake.runs == []


@pytest.mark.parametrize("kwargs,error", [
    ({"ready": False}, SyllabiMissingError),
    ({"details": False}, CourseEquivalencyDetailsMissingError),
    ({"status": "Completed"}, RerunNotAllowedError),
])
def test_rerun_is_refused_without_the_preconditions(repo, agents, kwargs, error):
    fake = repo(**kwargs)
    calls = agents(outcome())
    with pytest.raises(error):
        service.ensure_evaluation(RID, SESSION, rerun=True)
    assert calls == [] and fake.runs == []


def test_unknown_and_other_requests_are_refused_before_anything(repo, agents):
    fake = repo(request_type="Raise Capacity")
    calls = agents(outcome())
    with pytest.raises(NotCourseEquivalencyRequestError):
        service.ensure_evaluation(RID, SESSION, rerun=False)
    fake.requests.clear()
    with pytest.raises(RequestNotFoundError):
        service.ensure_evaluation(RID, SESSION, rerun=True)
    assert calls == [] and fake.runs == []


def test_first_open_does_nothing_when_already_evaluated_and_rerun_adds_history(repo, agents):
    fake = repo()
    agents(outcome())
    service.ensure_evaluation(RID, SESSION, rerun=False)
    assert service.ensure_evaluation(RID, SESSION, rerun=False).reason == "already_evaluated"
    service.ensure_evaluation(RID, SESSION, rerun=True)
    assert [r["run_trigger"] for r in fake.runs] == ["first_open", "rerun"]


def test_a_running_run_blocks_first_open_and_rerun(repo, agents):
    fake = repo()
    fake.start_run(None, RID, "first_open", "u", 1, AGENT_VERSION)
    calls = agents(outcome())
    out = service.ensure_evaluation(RID, SESSION, rerun=False)
    assert out.reason == "running" and out.in_progress
    with pytest.raises(RunInProgressError):
        service.ensure_evaluation(RID, SESSION, rerun=True)
    assert calls == []


def test_unique_index_race(repo, agents):
    fake = repo()
    fake.race_on_start = True
    agents(outcome())
    assert service.ensure_evaluation(RID, SESSION, rerun=False).reason == "running"
    with pytest.raises(RunInProgressError):
        service.ensure_evaluation(RID, SESSION, rerun=True)


def test_interrupted_run_is_expired_before_a_new_one(repo, agents):
    fake = repo()
    fake.start_run(None, RID, "first_open", "u", 1, AGENT_VERSION)
    fake.runs[0]["_stale"] = True
    agents(outcome())
    state = service.read_evaluation(RID)
    assert state["latest_attempt"]["run_status"] == "interrupted" and not state["in_progress"]
    service.ensure_evaluation(RID, SESSION, rerun=True)
    assert [r["run_status"] for r in fake.runs] == ["failed", "completed"]
    assert fake.runs[0]["failure_kind"] == "interrupted"


@pytest.mark.parametrize("error,kind,message", [
    (GeminiUnavailableError("Gemini request failed on every configured model: 503"), "technical", "Gemini request failed"),
    (SyllabusIntegrityError("The syllabus file for the requested course does not have its registered size."), "data", "registered size"),
    (SyllabiMissingError("No current syllabus is registered for the requested course."), "data", "No current syllabus"),
    (storage.StorageAccessDeniedError("403"), "technical", service.STORAGE_DENIED_MESSAGE),
    (storage.StorageUnavailableError("timeout"), "technical", service.STORAGE_UNAVAILABLE_MESSAGE),
    (DatabaseUnavailableError("down"), "technical", "database could not be reached"),
    (OperationalError("SELECT", {}, Exception("x")), "technical", "database refused a read"),
    (KeyError("U99000001"), "technical", "Unexpected error during the eligibility check (KeyError)"),
])
def test_failures_are_classified_and_never_carry_an_outcome(repo, agents, error, kind, message):
    fake = repo()
    agents(error)
    service.ensure_evaluation(RID, SESSION, rerun=False)
    run = fake.runs[0]
    assert run["run_status"] == "failed" and run["failure_kind"] == kind and message in run["error_message"]
    assert run["recommendation"] is None and run["reasoning"] is None and "U99000001" not in run["error_message"]


def test_gemini_outage_is_never_manual_review(repo, agents):
    fake = repo()
    agents(GeminiUnavailableError("Gemini request failed: 429"))
    service.ensure_evaluation(RID, SESSION, rerun=False)
    assert fake.runs[0]["recommendation"] is None and fake.runs[0]["run_status"] == "failed"


def test_blank_reasoning_or_missing_model_is_a_technical_failure(repo, agents):
    fake = repo()
    agents(outcome(reasoning="  "))
    service.ensure_evaluation(RID, SESSION, rerun=False)
    agents(outcome(assessment_model=None))
    service.ensure_evaluation(RID, SESSION, rerun=True)
    assert [r["failure_kind"] for r in fake.runs] == ["technical", "technical"]


def test_failed_rerun_keeps_the_last_successful_result(repo, agents):
    fake = repo()
    agents(outcome("MANUAL_REVIEW"))
    service.ensure_evaluation(RID, SESSION, rerun=False)
    agents(GeminiUnavailableError("Gemini request failed: 503"))
    service.ensure_evaluation(RID, SESSION, rerun=True)
    state = service.read_evaluation(RID)
    assert state["current"]["recommendation"] == "MANUAL_REVIEW" and state["current"]["id"] == 1
    assert state["latest_attempt"]["run_status"] == "failed" and state["run_count"] == 2


def test_replaced_syllabus_marks_the_result_outdated_and_offers_a_rerun(repo, agents):
    fake = repo()
    agents(outcome())
    service.ensure_evaluation(RID, SESSION, rerun=False)
    state = service.read_evaluation(RID)
    assert state["current"]["outdated"] is False and state["current"]["outdated_sides"] == []
    fake.current[RID]["new"] = SID_NEW2                       # a staff member replaced the new-course syllabus
    state = service.read_evaluation(RID)
    assert state["current"]["outdated"] is True and state["current"]["outdated_sides"] == ["new"]
    assert state["can_rerun"] is True and state["auto_run_eligible"] is False
    assert service.ensure_evaluation(RID, SESSION, rerun=False).reason == "already_evaluated"   # never automatic
    agents(outcome(new=SID_NEW2))
    service.ensure_evaluation(RID, SESSION, rerun=True)
    state = service.read_evaluation(RID)
    assert state["current"]["outdated"] is False and state["run_count"] == 2


def test_read_state_flags(repo):
    repo(ready=False)
    state = service.read_evaluation(RID)
    assert state["syllabi_ready"] is False and state["syllabi_missing_message"] == service.SYLLABI_MISSING_MESSAGE
    assert state["auto_run_eligible"] is False and state["can_rerun"] is False and state["current"] is None
    assert state["policy_status"] == "draft_thresholds"
    repo()
    state = service.read_evaluation(RID)
    assert state["auto_run_eligible"] is True and state["can_rerun"] is True


@pytest.mark.parametrize("sources,auto,reason", [
    ({"old": "legacy_import", "new": "legacy_import"}, False, "legacy_syllabi"),     # earlier upload system only
    ({"old": "staff_upload", "new": "staff_upload"}, True, None),                    # new staff workflow
    ({"old": "legacy_import", "new": "staff_upload"}, True, None),                   # one side re-uploaded by staff
    ({"old": "staff_upload", "new": "legacy_import"}, True, None),
])
def test_first_run_is_automatic_only_unless_both_syllabi_are_legacy_imports(repo, sources, auto, reason):
    fake = repo()
    fake.sources[RID] = sources
    state = service.read_evaluation(RID)
    assert state["first_run_eligible"] is True
    assert state["auto_run_eligible"] is auto
    assert state["manual_start_reason"] == reason
    assert state["current_syllabus_sources"] == sources


def test_legacy_syllabi_can_still_be_evaluated_manually_with_every_rule_unchanged(repo, agents):
    fake = repo()
    fake.sources[RID] = {"old": "legacy_import", "new": "legacy_import"}
    calls = agents(outcome())
    # The explicit staff action (POST rerun=false) runs the first evaluation as before.
    assert service.ensure_evaluation(RID, SESSION, rerun=False).reason == "started"
    assert calls == [(RID, TOKEN)] and fake.runs[0]["run_trigger"] == "first_open"
    state = service.read_evaluation(RID)
    assert state["first_run_eligible"] is False and state["auto_run_eligible"] is False
    assert service.ensure_evaluation(RID, SESSION, rerun=False).reason == "already_evaluated"


def test_legacy_rule_does_not_bypass_eligibility(repo):
    fake = repo(ready=False)
    fake.sources[RID] = {"old": "legacy_import", "new": None}
    state = service.read_evaluation(RID)
    assert state["first_run_eligible"] is False and state["auto_run_eligible"] is False
    assert state["manual_start_reason"] is None
    fake2 = repo(status="Completed")
    fake2.sources[RID] = {"old": "legacy_import", "new": "legacy_import"}
    state = service.read_evaluation(RID)
    assert state["first_run_eligible"] is False and state["auto_run_eligible"] is False


def test_legacy_rule_uses_registry_metadata_not_request_ids():
    import inspect
    source = inspect.getsource(service.read_evaluation) + inspect.getsource(service.legacy_syllabi_only)
    assert "STUD_" not in source and "legacy_import" in inspect.getsource(service)


def test_service_never_changes_requests_or_creates_decisions():
    import inspect
    from app.agents.course_equivalency import repository
    for module in (service, repository):
        source = inspect.getsource(module).upper()
        for forbidden in ('UPDATE PUBLIC', 'INSERT INTO PUBLIC', 'DELETE FROM', '"DECISION"', 'TAKES"'):
            assert forbidden not in source, (module.__name__, forbidden)

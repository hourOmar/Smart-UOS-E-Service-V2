"""Staff API for Incomplete Exam evaluations: authentication and authorization,
validation, status codes, response structure, read-only GET, the details-missing
state, and evaluation behaviour through the real service with an in-memory run
history. No database, no Supabase Auth or Storage and no Gemini calls."""

import json
import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.agents.incomplete_exam import service, workflow
from app.agents.incomplete_exam.exceptions import ProofFileMissingError
from app.api import incomplete_exam_review as api
from app.core import auth, storage
from app.core.database import DatabaseUnavailableError
from app.core.gemini import GeminiUnavailableError
from app.main import app

from .fakes import STUDENT_ID, STUDENT_NAME, TOKEN
from .test_service import RID, SESSION, STAFF, FakeRepo, _no_db, outcome

BASE = "/api/staff/incomplete-exam"
RUN_KEYS = {"id", "run_status", "trigger", "started_at", "finished_at", "recommendation", "reasoning",
            "check_explanations", "deterministic_results", "recommendation_conflict", "evidence", "proof_files",
            "rejection_explanation", "assessment_model", "rejection_model", "agent_version", "failure_kind",
            "error_message"}


@pytest.fixture
def client():
    app.dependency_overrides[auth.require_staff] = lambda: STAFF
    app.dependency_overrides[auth.require_staff_session] = lambda: SESSION
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def history(monkeypatch):
    """The real service on an in-memory run history; returns the fake repository."""
    def install(**kwargs):
        fake = FakeRepo(**kwargs)
        monkeypatch.setattr(service, "repo", fake)
        monkeypatch.setattr(service, "read_only", _no_db)
        monkeypatch.setattr(service, "write_transaction", _no_db)
        return fake
    return install


@pytest.fixture
def agents(monkeypatch):
    def install(result):
        calls = []

        def run(request_id, access_token):
            calls.append((request_id, access_token))
            if isinstance(result, BaseException):
                raise result
            return result
        monkeypatch.setattr(workflow, "run_incomplete_exam_agents", run)
        return calls
    return install


@pytest.fixture
def nothing_may_run(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("must not be called")
    monkeypatch.setattr(api, "read_evaluation", forbidden)
    monkeypatch.setattr(api, "ensure_evaluation", forbidden)


# -- authentication and authorization --------------------------------------------------------

def test_no_session_is_401_before_anything_is_read(nothing_may_run):
    anonymous = TestClient(app)
    assert anonymous.get(f"{BASE}/{RID}/evaluation").status_code == 401
    assert anonymous.post(f"{BASE}/{RID}/evaluations", json={"rerun": False}).status_code == 401
    assert anonymous.get(f"{BASE}/{RID}/evaluation", headers={"Authorization": "Basic x"}).status_code == 401
    assert anonymous.post(f"{BASE}/{RID}/evaluations", json={}, headers={"Authorization": "Bearer "}).status_code == 401


def test_invalid_session_is_401(monkeypatch, nothing_may_run):
    def invalid(token):
        raise auth.SessionInvalidError("no")
    monkeypatch.setattr(auth, "verify_session", invalid)
    anonymous = TestClient(app)
    headers = {"Authorization": "Bearer forged"}
    assert anonymous.get(f"{BASE}/{RID}/evaluation", headers=headers).status_code == 401
    assert anonymous.post(f"{BASE}/{RID}/evaluations", json={}, headers=headers).status_code == 401


def test_signed_in_non_staff_is_403(monkeypatch, nothing_may_run):
    monkeypatch.setattr(auth, "verify_session", lambda token: "00000000-0000-0000-0000-00000000005a")
    monkeypatch.setattr(auth, "find_staff", lambda uid: None)
    headers = {"Authorization": "Bearer student-token"}
    anonymous = TestClient(app)
    assert anonymous.get(f"{BASE}/{RID}/evaluation", headers=headers).status_code == 403
    assert anonymous.post(f"{BASE}/{RID}/evaluations", json={"rerun": True}, headers=headers).status_code == 403


def test_auth_service_down_is_503(monkeypatch, nothing_may_run):
    def down(token):
        raise auth.AuthServiceUnavailableError("down")
    monkeypatch.setattr(auth, "verify_session", down)
    response = TestClient(app).post(f"{BASE}/{RID}/evaluations", json={}, headers={"Authorization": "Bearer t"})
    assert response.status_code == 503


def test_real_staff_session_reaches_the_route_and_its_own_token_is_used(monkeypatch, history, agents):
    history()
    calls = agents(outcome("APPROVE"))
    monkeypatch.setattr(auth, "verify_session", lambda token: STAFF.auth_user_id)
    monkeypatch.setattr(auth, "find_staff", lambda uid: STAFF.staff_id)
    anonymous = TestClient(app)
    headers = {"Authorization": f"Bearer {TOKEN}"}
    assert anonymous.get(f"{BASE}/{RID}/evaluation", headers=headers).status_code == 200
    response = anonymous.post(f"{BASE}/{RID}/evaluations", json={}, headers=headers)
    assert response.status_code == 200
    assert calls == [(RID, TOKEN)]
    assert TOKEN not in response.text


# -- validation ---------------------------------------------------------------------------------------

@pytest.mark.parametrize("body", [{"rerun": "yes"}, {"rerun": 1}, {"rerun": None}, {"rerun": True, "extra": 1},
                                  [], "rerun", None])
def test_invalid_bodies_are_422(client, nothing_may_run, body):
    response = client.post(f"{BASE}/{RID}/evaluations", json=body) if body is not None \
        else client.post(f"{BASE}/{RID}/evaluations")
    assert response.status_code == 422


def test_request_id_longer_than_64_characters_is_422(client, nothing_may_run):
    assert client.get(f"{BASE}/{'X' * 65}/evaluation").status_code == 422
    assert client.post(f"{BASE}/{'X' * 65}/evaluations", json={}).status_code == 422


def test_other_methods_are_not_allowed(client, nothing_may_run):
    assert client.post(f"{BASE}/{RID}/evaluation", json={}).status_code == 405
    assert client.get(f"{BASE}/{RID}/evaluations").status_code == 405
    assert client.delete(f"{BASE}/{RID}/evaluation").status_code == 405


# -- GET is read-only --------------------------------------------------------------------------------

def test_get_never_runs_the_agents(client, history, agents):
    fake = history()
    calls = agents(outcome())
    response = client.get(f"{BASE}/{RID}/evaluation")
    assert response.status_code == 200 and calls == [] and fake.runs == [] and fake.locks == []
    evaluation = response.json()["evaluation"]
    assert evaluation == {"request_id": RID, "request_status": "In Progress", "details_missing": False,
                          "details_missing_message": None, "current": None, "latest_attempt": None,
                          "in_progress": False, "run_count": 0, "auto_run_eligible": True, "can_rerun": True}


# -- evaluations ---------------------------------------------------------------------------------------

def test_first_evaluation_and_response_structure(client, history, agents):
    history()
    agents(outcome("APPROVE"))
    response = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": False})
    assert response.status_code == 200
    evaluation = response.json()["evaluation"]
    assert evaluation["started_by_this_call"] is True and evaluation["outcome"] == "started"
    assert evaluation["auto_run_eligible"] is False and evaluation["can_rerun"] is True
    assert evaluation["run_count"] == 1 and evaluation["latest_attempt"] is None
    current = evaluation["current"]
    assert set(current) == RUN_KEYS
    assert current["run_status"] == "completed" and current["trigger"] == "first_open"
    assert current["recommendation"] == "APPROVE" and current["rejection_explanation"] is None
    assert current["recommendation_conflict"] is False and current["error_message"] is None
    assert current["deterministic_results"]["submission_window"]["satisfied"] is True
    assert current["proof_files"][0]["outcome"] == "attached"
    assert TOKEN not in response.text and "synthetic proof document" not in response.text


def test_reject_includes_the_suggested_reasons(client, history, agents):
    history()
    agents(outcome("REJECT"))
    current = client.post(f"{BASE}/{RID}/evaluations", json={}).json()["evaluation"]["current"]
    assert current["recommendation"] == "REJECT" and current["rejection_model"] == "rej-model"
    assert current["rejection_explanation"]["suggested_reasons"][0]["tone"] == "formal"


def test_empty_body_means_first_evaluation(client, history, agents):
    fake = history()
    agents(outcome())
    assert client.post(f"{BASE}/{RID}/evaluations", json={}).json()["evaluation"]["outcome"] == "started"
    assert fake.runs[0]["run_trigger"] == "first_open"


def test_first_evaluation_runs_only_once(client, history, agents):
    fake = history()
    agents(outcome())
    client.post(f"{BASE}/{RID}/evaluations", json={})
    calls = agents(outcome())
    evaluation = client.post(f"{BASE}/{RID}/evaluations", json={}).json()["evaluation"]
    assert evaluation["outcome"] == "already_evaluated" and evaluation["started_by_this_call"] is False
    assert calls == [] and len(fake.runs) == 1


def test_rerun_runs_again(client, history, agents):
    fake = history()
    agents(outcome("APPROVE"))
    client.post(f"{BASE}/{RID}/evaluations", json={})
    agents(outcome("REJECT"))
    evaluation = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": True}).json()["evaluation"]
    assert evaluation["current"]["recommendation"] == "REJECT" and evaluation["current"]["trigger"] == "rerun"
    assert evaluation["run_count"] == 2 and len(fake.runs) == 2


def test_concurrent_run_is_409_for_rerun_and_reported_for_first_open(client, history, agents):
    fake = history()
    fake.start_run(None, RID, "first_open", STAFF.auth_user_id, STAFF.staff_id, "1.1.0")
    calls = agents(outcome())
    response = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": True})
    assert response.status_code == 409 and response.json()["detail"] == \
        "An eligibility check is already running for this request."
    evaluation = client.post(f"{BASE}/{RID}/evaluations", json={}).json()["evaluation"]
    assert evaluation["outcome"] == "running" and evaluation["in_progress"] is True
    assert evaluation["can_rerun"] is False and evaluation["latest_attempt"]["run_status"] == "running"
    assert calls == []


@pytest.mark.parametrize("status", ["Completed", "Rejected"])
def test_finalized_requests(client, history, agents, status):
    fake = history(status=status)
    calls = agents(outcome())
    evaluation = client.post(f"{BASE}/{RID}/evaluations", json={}).json()["evaluation"]
    assert evaluation["outcome"] == "not_in_progress" and evaluation["can_rerun"] is False
    assert evaluation["auto_run_eligible"] is False
    response = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": True})
    assert response.status_code == 409 and "Only In Progress requests" in response.json()["detail"]
    assert calls == [] and fake.runs == []


# -- details missing ----------------------------------------------------------------------------------

def test_details_missing_state_and_no_automatic_run(client, history, agents):
    fake = history(details=False)
    calls = agents(outcome())
    evaluation = client.get(f"{BASE}/{RID}/evaluation").json()["evaluation"]
    assert evaluation["details_missing"] is True
    assert evaluation["details_missing_message"] == service.DETAILS_MISSING_MESSAGE
    assert evaluation["auto_run_eligible"] is False and evaluation["can_rerun"] is False
    response = client.post(f"{BASE}/{RID}/evaluations", json={})
    assert response.status_code == 200
    assert response.json()["evaluation"]["outcome"] == "details_missing"
    assert response.json()["evaluation"]["started_by_this_call"] is False
    assert calls == [] and fake.runs == []


def test_details_missing_rerun_is_409(client, history, agents):
    fake = history(details=False)
    calls = agents(outcome())
    response = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": True})
    assert response.status_code == 409 and response.json()["detail"] == service.DETAILS_MISSING_MESSAGE
    assert calls == [] and fake.runs == []


# -- not found ------------------------------------------------------------------------------------------

@pytest.mark.parametrize("request_type, request_id, detail", [
    ("Incomplete Exam", "STUD_INCRQ_INC2_999999", "Request not found."),
    ("Raise Capacity", RID, "This is not an Incomplete Exam request."),
])
def test_unknown_or_other_type_is_404(client, history, agents, request_type, request_id, detail):
    fake = history(request_type=request_type)
    calls = agents(outcome())
    for response in (client.get(f"{BASE}/{request_id}/evaluation"),
                     client.post(f"{BASE}/{request_id}/evaluations", json={}),
                     client.post(f"{BASE}/{request_id}/evaluations", json={"rerun": True})):
        assert response.status_code == 404 and response.json() == {"detail": detail}
    assert calls == [] and fake.runs == []


# -- failures ----------------------------------------------------------------------------------------------

@pytest.mark.parametrize("error, kind, shown", [
    (GeminiUnavailableError("Gemini request failed: ServerError 503 UNAVAILABLE: overloaded"), "technical",
     api._TECHNICAL_MESSAGES["gemini"]),
    (storage.StorageAccessDeniedError("x"), "technical", service.STORAGE_DENIED_MESSAGE),
    (storage.StorageUnavailableError("x"), "technical", service.STORAGE_UNAVAILABLE_MESSAGE),
    (DatabaseUnavailableError("x"), "technical", api._TECHNICAL_MESSAGES["database"]),
    (KeyError("x"), "technical", api._TECHNICAL_MESSAGES["other"]),
    (ProofFileMissingError("A proof file listed for this request was not found in Storage."), "data",
     "A proof file listed for this request was not found in Storage."),
])
def test_failed_runs_show_no_recommendation_and_no_internal_detail(client, history, agents, error, kind, shown):
    history()
    agents(error)
    response = client.post(f"{BASE}/{RID}/evaluations", json={})
    assert response.status_code == 200
    evaluation = response.json()["evaluation"]
    attempt = evaluation["latest_attempt"]
    assert evaluation["current"] is None and evaluation["outcome"] == "started"
    assert attempt["run_status"] == "failed" and attempt["failure_kind"] == kind
    assert attempt["recommendation"] is None and attempt["rejection_explanation"] is None
    assert attempt["error_message"] == shown
    assert "overloaded" not in response.text and "MANUAL_REVIEW" not in response.text


def test_a_failed_rerun_keeps_the_last_successful_result(client, history, agents):
    history()
    agents(outcome("REJECT"))
    client.post(f"{BASE}/{RID}/evaluations", json={})
    agents(GeminiUnavailableError("Gemini request failed: 503"))
    evaluation = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": True}).json()["evaluation"]
    assert evaluation["current"]["recommendation"] == "REJECT"
    assert evaluation["latest_attempt"]["run_status"] == "failed"
    assert evaluation["latest_attempt"]["error_message"] == api._TECHNICAL_MESSAGES["gemini"]


@pytest.mark.parametrize("error", [OperationalError("SELECT", {}, Exception("secret-detail")),
                                   DatabaseUnavailableError("secret-detail")])
def test_database_problems_are_503_without_detail(client, monkeypatch, error):
    def broken(*args, **kwargs):
        raise error
    monkeypatch.setattr(api, "read_evaluation", broken)
    monkeypatch.setattr(api, "ensure_evaluation", broken)
    for response in (client.get(f"{BASE}/{RID}/evaluation"), client.post(f"{BASE}/{RID}/evaluations", json={})):
        assert response.status_code == 503 and "secret-detail" not in response.text


def test_logs_carry_no_student_evidence_or_token(client, history, agents, caplog):
    history()
    agents(GeminiUnavailableError("Gemini request failed: 503"))
    with caplog.at_level(logging.DEBUG):
        client.post(f"{BASE}/{RID}/evaluations", json={})
        agents(outcome("REJECT"))
        client.post(f"{BASE}/{RID}/evaluations", json={"rerun": True})
    for secret in (TOKEN, STUDENT_NAME, STUDENT_ID, "hospital"):
        assert secret not in caplog.text


def test_responses_are_json_serializable_without_bytes(client, history, agents):
    history()
    agents(outcome("REJECT"))
    body = client.post(f"{BASE}/{RID}/evaluations", json={}).json()
    assert "synthetic proof document" not in json.dumps(body)


# -- registration -------------------------------------------------------------------------------------------

@pytest.mark.parametrize("method, path", [("GET", f"{BASE}/{RID}/evaluation"), ("POST", f"{BASE}/{RID}/evaluations")])
def test_every_staff_route_is_registered_and_asks_for_a_session(method, path):
    response = TestClient(app).request(method, path, json={})
    assert response.status_code == 401


def test_routes_use_the_staff_dependencies():
    routes = {(next(iter(r.methods)), r.path): r for r in api.router.routes}
    assert set(routes) == {("GET", f"{BASE}/{{request_id}}/evaluation"), ("POST", f"{BASE}/{{request_id}}/evaluations")}
    get_deps = {d.call for d in routes[("GET", f"{BASE}/{{request_id}}/evaluation")].dependant.dependencies}
    post_deps = {d.call for d in routes[("POST", f"{BASE}/{{request_id}}/evaluations")].dependant.dependencies}
    assert auth.require_staff in get_deps and auth.require_staff_session not in get_deps
    assert auth.require_staff_session in post_deps


def test_other_staff_apis_are_still_registered_and_protected():
    anonymous = TestClient(app)
    assert anonymous.get("/api/health").json() == {"status": "ok"}
    assert anonymous.get(f"/api/staff/program-change/{RID}/evaluation").status_code == 401
    assert anonymous.get(f"/api/staff/raise-capacity/{RID}/review").status_code == 401

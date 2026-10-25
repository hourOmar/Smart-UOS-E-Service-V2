"""Staff API for Program Change evaluations: authentication and authorization,
validation, status codes, response structure, read-only GET, and evaluation
behaviour through the real service with an in-memory run history. No database,
no Supabase Auth and no Gemini calls."""

import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.agents.program_change_eligibility import eligibility_agent, evidence, service, workflow
from app.api import program_change_review as api
from app.core import auth, gemini
from app.core.database import DatabaseUnavailableError
from app.core.gemini import GeminiUnavailableError
from app.main import app

from .fakes import (
    STUDY_PLAN_REPLY, FakeTextModels, approve_transcript, course, program_change_request,
)
from .test_service import RID, STAFF, FakeRepo, _no_db, historical, structured, success

BASE = "/api/staff/program-change"


@pytest.fixture
def client():
    app.dependency_overrides[auth.require_staff] = lambda: STAFF
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
def agent_outcome(monkeypatch):
    def install(outcome):
        calls = []

        def run(request_id):
            calls.append(request_id)
            if isinstance(outcome, BaseException):
                raise outcome
            return outcome
        monkeypatch.setattr(workflow, "evaluate_program_change_request", run)
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


def test_invalid_session_is_401(monkeypatch, nothing_may_run):
    def invalid(token):
        raise auth.SessionInvalidError("no")
    monkeypatch.setattr(auth, "verify_session", invalid)
    response = TestClient(app).get(f"{BASE}/{RID}/evaluation", headers={"Authorization": "Bearer forged"})
    assert response.status_code == 401


def test_signed_in_non_staff_is_403(monkeypatch, nothing_may_run):
    monkeypatch.setattr(auth, "verify_session", lambda token: "00000000-0000-0000-0000-00000000005a")
    monkeypatch.setattr(auth, "find_staff", lambda uid: None)
    headers = {"Authorization": "Bearer student-token"}
    anonymous = TestClient(app)
    assert anonymous.get(f"{BASE}/{RID}/evaluation", headers=headers).status_code == 403
    assert anonymous.post(f"{BASE}/{RID}/evaluations", json={"rerun": True}, headers=headers).status_code == 403


def test_staff_session_reaches_the_route(monkeypatch, history):
    history()
    monkeypatch.setattr(auth, "verify_session", lambda token: STAFF.auth_user_id)
    monkeypatch.setattr(auth, "find_staff", lambda uid: STAFF.staff_id)
    response = TestClient(app).get(f"{BASE}/{RID}/evaluation", headers={"Authorization": "Bearer staff-token"})
    assert response.status_code == 200


# -- validation ---------------------------------------------------------------------------------------

@pytest.mark.parametrize("body", [{"rerun": "yes"}, {"rerun": 1}, {"rerun": None}, {"rerun": True, "extra": 1}, None])
def test_invalid_bodies_are_422(client, nothing_may_run, body):
    response = client.post(f"{BASE}/{RID}/evaluations", json=body) if body is not None \
        else client.post(f"{BASE}/{RID}/evaluations")
    assert response.status_code == 422


def test_request_id_longer_than_64_characters_is_422(client, nothing_may_run):
    assert client.get(f"{BASE}/{'X' * 65}/evaluation").status_code == 422


# -- GET is read-only --------------------------------------------------------------------------------

def test_get_never_runs_the_agent(client, history, agent_outcome):
    fake = history()
    calls = agent_outcome(success())
    response = client.get(f"{BASE}/{RID}/evaluation")
    assert response.status_code == 200
    body = response.json()["evaluation"]
    assert body == {"request_id": RID, "request_status": "In Progress", "current": None, "latest_attempt": None,
                    "in_progress": False, "run_count": 0, "auto_run_eligible": True, "can_rerun": True}
    assert calls == [] and fake.runs == [] and fake.locks == []


# -- POST: first evaluation, reruns, duplicates -----------------------------------------------------

def test_first_evaluation_and_response_structure(client, history, agent_outcome):
    history()
    agent_outcome(success("REQUIRES_REVIEW"))
    response = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": False})
    assert response.status_code == 200
    body = response.json()["evaluation"]
    assert body["started_by_this_call"] is True and body["outcome"] == "started"
    current = body["current"]
    assert current["run_status"] == "completed" and current["recommendation"] == "REQUIRES_REVIEW"
    assert current["report"] and current["deterministic_results"]["applicable_hours"] == 24
    assert current["evidence"] == {"request_id": RID, "reference_files": []}
    assert current["study_plan_model"] == "m-plan" and current["assessment_model"] == "m-assess"
    assert current["failure_kind"] is None and current["error_message"] is None
    assert set(current) == {"id", "run_status", "trigger", "started_at", "finished_at", "recommendation", "report",
                            "deterministic_results", "eligibility", "evidence", "study_plan_model",
                            "assessment_model", "agent_version", "failure_kind", "error_message"}
    assert "triggered_by" not in current and "triggered_by_staff_id" not in current
    assert body["latest_attempt"] is None and body["run_count"] == 1 and body["auto_run_eligible"] is False


def test_structured_eligibility_in_the_response(client, history, agent_outcome):
    history()
    agent_outcome(success("APPROVE", structured(hours=3, hours_ok=False, completed=3)))
    client.post(f"{BASE}/{RID}/evaluations", json={})
    current = client.get(f"{BASE}/{RID}/evaluation").json()["evaluation"]["current"]
    assert current["recommendation"] == "APPROVE"   # stored as returned, never overridden
    assert current["eligibility"] == {
        "recorded": True,
        "cgpa": {"value": 3.72, "minimum": 2.0, "passed": True},
        "applicable_hours": {"value": 3, "minimum": 15, "passed": False},
        "completed_hours": 3,
        "recommendation_conflict": True,
    }


def test_historical_eligibility_in_the_response(client, history, agent_outcome):
    history()
    agent_outcome(success("REJECT", historical()))
    client.post(f"{BASE}/{RID}/evaluations", json={})
    current = client.get(f"{BASE}/{RID}/evaluation").json()["evaluation"]["current"]
    assert current["deterministic_results"] == historical()
    assert current["eligibility"] == {
        "recorded": False,
        "cgpa": {"value": 3.72, "minimum": None, "passed": True},
        "applicable_hours": {"value": 3, "minimum": None, "passed": None},
        "completed_hours": 3,
        "recommendation_conflict": False,
    }


def test_empty_body_means_first_evaluation(client, history, agent_outcome):
    history()
    agent_outcome(success())
    assert client.post(f"{BASE}/{RID}/evaluations", json={}).json()["evaluation"]["outcome"] == "started"


def test_first_evaluation_runs_only_once(client, history, agent_outcome):
    history()
    calls = agent_outcome(success())
    client.post(f"{BASE}/{RID}/evaluations", json={})
    again = client.post(f"{BASE}/{RID}/evaluations", json={}).json()["evaluation"]
    assert again["started_by_this_call"] is False and again["outcome"] == "already_evaluated"
    assert calls == [RID]


def test_rerun_while_in_progress_runs_again(client, history, agent_outcome):
    fake = history()
    agent_outcome(success("APPROVE"))
    client.post(f"{BASE}/{RID}/evaluations", json={})
    agent_outcome(success("REJECT"))
    body = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": True}).json()["evaluation"]
    assert body["started_by_this_call"] is True and body["current"]["recommendation"] == "REJECT"
    assert [r["run_trigger"] for r in fake.runs] == ["first_open", "rerun"]


def test_rerun_while_another_run_is_in_progress_is_409(client, history, agent_outcome):
    fake = history()
    fake.start_run(None, RID, "first_open", STAFF.auth_user_id, 1, "1.0.0")
    calls = agent_outcome(success())
    response = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": True})
    assert response.status_code == 409
    assert response.json() == {"detail": "An eligibility check is already running for this request."}
    first_open = client.post(f"{BASE}/{RID}/evaluations", json={}).json()["evaluation"]
    assert first_open["outcome"] == "running" and first_open["in_progress"] is True
    assert calls == [] and len(fake.runs) == 1


@pytest.mark.parametrize("status", ["Completed", "Rejected"])
def test_finalized_requests(client, history, agent_outcome, status):
    fake = history(status=status)
    calls = agent_outcome(success())
    rerun = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": True})
    assert rerun.status_code == 409
    assert rerun.json() == {"detail": "Only In Progress requests can be evaluated again; the saved evaluations are kept."}
    first_open = client.post(f"{BASE}/{RID}/evaluations", json={})
    assert first_open.status_code == 200
    body = first_open.json()["evaluation"]
    assert body["started_by_this_call"] is False and body["outcome"] == "not_in_progress"
    assert body["can_rerun"] is False and body["auto_run_eligible"] is False
    assert calls == [] and fake.runs == []


@pytest.mark.parametrize("request_type, detail", [
    (None, "Request not found."), ("Raise Capacity", "This is not a Program Change request."),
])
def test_unknown_or_other_type_is_404(client, history, agent_outcome, request_type, detail):
    fake = history(request_type=request_type or "Program Change")
    request_id = "STUD_UNKNOWN" if request_type is None else RID
    calls = agent_outcome(success())
    for response in (client.get(f"{BASE}/{request_id}/evaluation"),
                     client.post(f"{BASE}/{request_id}/evaluations", json={"rerun": True})):
        assert response.status_code == 404 and response.json() == {"detail": detail}
    assert calls == [] and fake.runs == []


# -- failures in the response -------------------------------------------------------------------------

@pytest.mark.parametrize("error, kind, shown", [
    (GeminiUnavailableError("Gemini request failed on every configured model: gemini-x: ServerError 503 UNAVAILABLE"),
     "technical", api._TECHNICAL_MESSAGES["gemini"]),
    (ValueError("Program mismatch: expected 'A', but Gemini returned 'B'. The study plan will not be used."),
     "technical", api._TECHNICAL_MESSAGES["study_plan"]),
    (KeyError("x"), "technical", api._TECHNICAL_MESSAGES["other"]),
    (DatabaseUnavailableError("down"), "technical", api._TECHNICAL_MESSAGES["database"]),
    (ValueError("Unknown grade: WF"), "data", "Unknown grade: WF"),
])
def test_failed_runs_show_no_recommendation_and_no_internal_detail(client, history, agent_outcome, error, kind, shown):
    fake = history()
    agent_outcome(error)
    body = client.post(f"{BASE}/{RID}/evaluations", json={}).json()["evaluation"]
    attempt = body["latest_attempt"]
    assert body["current"] is None
    assert attempt["run_status"] == "failed" and attempt["failure_kind"] == kind
    assert attempt["recommendation"] is None and attempt["report"] is None
    assert attempt["error_message"] == shown
    assert "gemini-x" not in str(body) and "ServerError" not in str(body)
    assert fake.runs[0]["error_message"]   # the full sanitized detail stays in the run history


def test_a_failed_rerun_keeps_the_last_successful_result(client, history, agent_outcome):
    history()
    agent_outcome(success("APPROVE"))
    client.post(f"{BASE}/{RID}/evaluations", json={})
    agent_outcome(GeminiUnavailableError("Gemini request failed: ServerError 503"))
    body = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": True}).json()["evaluation"]
    assert body["current"]["recommendation"] == "APPROVE"
    assert body["latest_attempt"]["run_status"] == "failed" and body["latest_attempt"]["recommendation"] is None
    assert body["can_rerun"] is True


@pytest.mark.parametrize("error", [OperationalError("SELECT", {}, Exception("secret detail")),
                                   DatabaseUnavailableError("secret detail")])
def test_database_problems_are_503_without_detail(client, monkeypatch, error):
    def unavailable(*args, **kwargs):
        raise error
    monkeypatch.setattr(api, "read_evaluation", unavailable)
    response = client.get(f"{BASE}/{RID}/evaluation")
    assert response.status_code == 503 and "secret detail" not in response.text


def test_logs_carry_no_student_evidence(client, history, monkeypatch, caplog):
    history()
    request = program_change_request(approve_transcript() + [course("0201399", "WF", name="Secret Course Name")],
                                     request_id=RID)
    monkeypatch.setattr(eligibility_agent, "get_program_change_request", lambda rid: request)
    monkeypatch.setattr(evidence, "get_program_change_request", lambda rid: request)
    models = FakeTextModels([STUDY_PLAN_REPLY])
    monkeypatch.setattr(gemini, "get_client", lambda: type("Client", (), {"models": models})())
    with caplog.at_level(logging.DEBUG):
        body = client.post(f"{BASE}/{RID}/evaluations", json={}).json()["evaluation"]
    assert body["latest_attempt"]["failure_kind"] == "data"
    assert body["latest_attempt"]["error_message"] == "Unknown grade: WF"
    for secret in ("Secret Course Name", "Synthetic reason."):
        assert secret not in caplog.text


# -- existing routes are untouched ----------------------------------------------------------------

@pytest.mark.parametrize("method, path", [
    ("get", "/api/staff/raise-capacity/R1/review"),
    ("post", "/api/staff/raise-capacity/R1/evaluations"),
    ("get", "/api/staff/raise-capacity/priorities?request_id=R1"),
    ("post", "/api/staff/raise-capacity/priorities/automatic"),
    ("post", "/api/staff/raise-capacity/R1/priority/retry"),
    ("get", f"{BASE}/R1/evaluation"),
    ("post", f"{BASE}/R1/evaluations"),
])
def test_every_staff_route_is_registered_and_asks_for_a_session(method, path):
    # 401 (not 404): the route exists and require_staff runs first.
    response = getattr(TestClient(app), method)(path, **({"json": {}} if method == "post" else {}))
    assert response.status_code == 401


def test_health_is_unchanged():
    assert TestClient(app).get("/api/health").json() == {"status": "ok"}

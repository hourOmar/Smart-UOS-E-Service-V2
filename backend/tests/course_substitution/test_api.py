"""Staff API for Course Substitution evaluations: authentication and authorization
(401/403 before anything is read), validation, not-found vs wrong request type,
status codes, staff-facing messages, and the real service on an in-memory run
history. No database, no Supabase Auth and no Gemini calls."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.agents.course_substitution_eligibility import service, workflow
from app.api import course_substitution_review as api
from app.core import auth
from app.core.gemini import GeminiUnavailableError
from app.main import app

from .test_service import RID, STAFF, FakeRepo, _no_db, _running_row, success

BASE = "/api/staff/course-substitution"


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
        monkeypatch.setattr(workflow, "evaluate_course_substitution_request", run)
        return calls
    return install


@pytest.fixture
def nothing_may_run(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("must not be called")
    monkeypatch.setattr(api, "read_evaluation", forbidden)
    monkeypatch.setattr(api, "ensure_evaluation", forbidden)
    monkeypatch.setattr(service, "repo", None)          # any read would fail loudly


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
    headers = {"Authorization": "Bearer forged"}
    assert TestClient(app).get(f"{BASE}/{RID}/evaluation", headers=headers).status_code == 401
    assert TestClient(app).post(f"{BASE}/{RID}/evaluations", json={"rerun": True}, headers=headers).status_code == 401


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


# -- validation ---------------------------------------------------------------------------------

@pytest.mark.parametrize("body", [{"rerun": "yes"}, {"rerun": 1}, {"rerun": None}, {"rerun": True, "extra": 1}, None])
def test_invalid_bodies_are_422(client, nothing_may_run, body):
    response = client.post(f"{BASE}/{RID}/evaluations", json=body) if body is not None \
        else client.post(f"{BASE}/{RID}/evaluations")
    assert response.status_code == 422


def test_overlong_request_id_is_422(client, nothing_may_run):
    assert client.get(f"{BASE}/{'R' * 65}/evaluation").status_code == 422


# -- not found vs wrong request type --------------------------------------------------------------

def test_unknown_request_is_404(client, history, agent_outcome):
    fake = history()
    calls = agent_outcome(success())
    for response in (client.get(f"{BASE}/NO_SUCH_REQUEST/evaluation"),
                     client.post(f"{BASE}/NO_SUCH_REQUEST/evaluations", json={"rerun": True})):
        assert response.status_code == 404
        assert response.json() == {"detail": "Request not found."}
    assert fake.runs == [] and calls == []


def test_other_request_type_is_404_with_its_own_message(client, history, agent_outcome):
    fake = history(request_type="Program Change")
    calls = agent_outcome(success())
    for response in (client.get(f"{BASE}/{RID}/evaluation"),
                     client.post(f"{BASE}/{RID}/evaluations", json={"rerun": False})):
        assert response.status_code == 404
        assert response.json() == {"detail": "This is not a Course Substitution request."}
    assert fake.runs == [] and calls == []


# -- GET is read-only -------------------------------------------------------------------------------

def test_get_never_runs_the_agent(client, history, agent_outcome):
    fake = history()
    calls = agent_outcome(success())
    body = client.get(f"{BASE}/{RID}/evaluation").json()["evaluation"]
    assert body["current"] is None and body["run_count"] == 0 and body["auto_run_eligible"] is True
    assert fake.runs == [] and calls == []


# -- POST ---------------------------------------------------------------------------------------------

def test_first_evaluation_runs_and_returns_the_saved_state(client, history, agent_outcome):
    history()
    agent_outcome(success())
    response = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": False})
    assert response.status_code == 200
    body = response.json()["evaluation"]
    assert body["started_by_this_call"] is True and body["outcome"] == "started"
    current = body["current"]
    assert current["overall_result"] == "ELIGIBLE" and current["run_status"] == "completed"
    assert (current["current_term"], current["current_semester"]) == (202601, "Fall")
    assert len(current["checks"]) == 5 and current["agent_version"] == "1.0.0"


def test_second_first_opening_returns_the_saved_state(client, history, agent_outcome):
    history()
    agent_outcome(success())
    client.post(f"{BASE}/{RID}/evaluations", json={"rerun": False})
    body = client.post(f"{BASE}/{RID}/evaluations", json={}).json()["evaluation"]
    assert body["started_by_this_call"] is False and body["outcome"] == "already_evaluated"
    assert body["run_count"] == 1


def test_rerun_while_running_is_409(client, history, agent_outcome):
    fake = history()
    fake.runs.append(_running_row(1))
    agent_outcome(success())
    response = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": True})
    assert response.status_code == 409
    assert response.json() == {"detail": "An eligibility check is already running for this request."}
    body = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": False}).json()["evaluation"]
    assert body["outcome"] == "running" and body["in_progress"] is True


def test_rerun_of_a_finalized_request_is_409(client, history, agent_outcome):
    history(status="Completed")
    agent_outcome(success())
    response = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": True})
    assert response.status_code == 409
    assert "Only In Progress requests" in response.json()["detail"]


def test_details_missing(client, history, agent_outcome):
    fake = history(details=False)
    calls = agent_outcome(success())
    body = client.get(f"{BASE}/{RID}/evaluation").json()["evaluation"]
    assert body["details_missing"] is True and body["can_rerun"] is False
    first = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": False}).json()["evaluation"]
    assert first["outcome"] == "details_missing" and first["started_by_this_call"] is False
    rerun = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": True})
    assert rerun.status_code == 409 and rerun.json() == {"detail": service.DETAILS_MISSING_MESSAGE}
    assert fake.runs == [] and calls == []


def test_failed_rerun_keeps_the_previous_result_with_a_staff_message(client, history, agent_outcome):
    history()
    agent_outcome(success())
    client.post(f"{BASE}/{RID}/evaluations", json={"rerun": False})
    agent_outcome(GeminiUnavailableError("Gemini request failed: ServerError 503 UNAVAILABLE: overloaded"))
    body = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": True}).json()["evaluation"]
    assert body["current"]["id"] == 1 and body["current"]["overall_result"] == "ELIGIBLE"
    attempt = body["latest_attempt"]
    assert attempt["id"] == 2 and attempt["run_status"] == "failed" and attempt["failure_kind"] == "technical"
    assert attempt["error_message"] == api._TECHNICAL_MESSAGES["gemini"]


@pytest.mark.parametrize("stored, shown", [
    ("GEMINI_API_KEY is not configured.", api._TECHNICAL_MESSAGES["gemini_key"]),
    ("Gemini request failed: ClientError 400", api._TECHNICAL_MESSAGES["gemini"]),
    ("The database could not be reached while collecting evidence.", api._TECHNICAL_MESSAGES["database"]),
    ("Unexpected error during the eligibility check (KeyError).", api._TECHNICAL_MESSAGES["other"]),
    (service.NOT_STORED_MESSAGE, service.NOT_STORED_MESSAGE),
])
def test_technical_failures_get_a_short_staff_message(stored, shown):
    assert api._staff_message("technical", stored) == shown


def test_data_failures_are_shown_as_stored():
    assert api._staff_message("data", "Original course 1501246 was not found.") == "Original course 1501246 was not found."


def test_database_outage_is_503(client, history, monkeypatch):
    history()

    def down(request_id):
        raise OperationalError("SELECT", {}, Exception("down"))
    monkeypatch.setattr(api, "read_evaluation", down)
    response = client.get(f"{BASE}/{RID}/evaluation")
    assert response.status_code == 503
    assert response.json() == {"detail": "Evaluations could not be loaded. Try again shortly."}


def test_router_paths_and_main_includes_it_once():
    assert sorted((route.path, tuple(route.methods)) for route in api.router.routes) == [
        (f"{BASE}/{{request_id}}/evaluation", ("GET",)), (f"{BASE}/{{request_id}}/evaluations", ("POST",))]
    main_source = (Path(api.__file__).parent.parent / "main.py").read_text(encoding="utf-8")
    assert main_source.count("app.include_router(course_substitution_review_router)") == 1

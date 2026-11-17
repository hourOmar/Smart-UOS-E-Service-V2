"""Staff API: authentication and authorization, validation, status codes, read-only GET,
the evaluation behaviour through the real service with an in-memory history, and safe
technical messages. No database, Supabase Auth or Storage, and no Gemini calls."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.agents.course_equivalency import service, workflow
from app.api import course_equivalency_review as api
from app.core import auth
from app.core.gemini import GeminiUnavailableError
from app.main import app

from .fakes import RID, SESSION, STAFF, TOKEN, FakeRepo, no_db
from .test_service import outcome

BASE = "/api/staff/course-equivalency"


@pytest.fixture
def client():
    app.dependency_overrides[auth.require_staff] = lambda: STAFF
    app.dependency_overrides[auth.require_staff_session] = lambda: SESSION
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def history(monkeypatch):
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

        def run(request_id, access_token):
            calls.append((request_id, access_token))
            if isinstance(result, BaseException):
                raise result
            return result
        monkeypatch.setattr(workflow, "run_course_equivalency_agents", run)
        return calls
    return install


def test_routes_require_a_staff_session():
    plain = TestClient(app)
    assert plain.get(f"{BASE}/{RID}/evaluation").status_code == 401
    assert plain.post(f"{BASE}/{RID}/evaluations", json={}).status_code == 401


def test_non_staff_session_is_forbidden(monkeypatch):
    monkeypatch.setattr(auth, "verify_session", lambda token: "00000000-0000-0000-0000-00000000aaaa")
    monkeypatch.setattr(auth, "find_staff", lambda uid: None)
    plain = TestClient(app)
    headers = {"Authorization": "Bearer student-token"}
    assert plain.get(f"{BASE}/{RID}/evaluation", headers=headers).status_code == 403
    assert plain.post(f"{BASE}/{RID}/evaluations", json={}, headers=headers).status_code == 403


def test_request_id_and_body_are_validated(client, history):
    history()
    assert client.get(f"{BASE}/STUD_RSCA_RSCA_000001/evaluation").status_code == 422
    assert client.post(f"{BASE}/{RID}/evaluations", json={"rerun": "yes"}).status_code == 422
    assert client.post(f"{BASE}/{RID}/evaluations", json={"rerun": False, "staff_id": 1}).status_code == 422


def test_get_is_read_only(client, history, agents):
    history()
    calls = agents(outcome())
    body = client.get(f"{BASE}/{RID}/evaluation").json()["evaluation"]
    assert calls == [] and body["auto_run_eligible"] is True and body["current"] is None
    assert body["policy_status"] == "draft_thresholds"


def test_first_open_then_already_evaluated(client, history, agents):
    history()
    calls = agents(outcome())
    body = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": False}).json()["evaluation"]
    assert body["outcome"] == "started" and body["started_by_this_call"] and body["current"]["recommendation"] == "APPROVE"
    assert calls == [(RID, TOKEN)]
    body = client.post(f"{BASE}/{RID}/evaluations", json={}).json()["evaluation"]
    assert body["outcome"] == "already_evaluated" and not body["started_by_this_call"]


def test_missing_syllabi_state_and_rerun_conflict(client, history, agents):
    history(ready=False)
    calls = agents(outcome())
    body = client.post(f"{BASE}/{RID}/evaluations", json={}).json()["evaluation"]
    assert body["outcome"] == "syllabi_missing" and body["run_count"] == 0
    r = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": True})
    assert r.status_code == 409 and "Both syllabi are required" in r.json()["detail"] and calls == []


@pytest.mark.parametrize("kwargs,status_code", [({"status": "Completed"}, 409), ({"details": False}, 409),
                                                ({"request_type": "Raise Capacity"}, 404)])
def test_rerun_conflicts_and_not_found(client, history, agents, kwargs, status_code):
    history(**kwargs)
    agents(outcome())
    assert client.post(f"{BASE}/{RID}/evaluations", json={"rerun": True}).status_code == status_code


def test_running_conflict(client, history, agents):
    fake = history()
    fake.start_run(None, RID, "first_open", "u", 1, "1.0.0")
    agents(outcome())
    assert client.post(f"{BASE}/{RID}/evaluations", json={"rerun": True}).status_code == 409


def test_technical_failure_message_is_generic_and_token_never_returned(client, history, agents):
    history()
    agents(GeminiUnavailableError("Gemini request failed: ServerError 503 UNAVAILABLE: detail"))
    body = client.post(f"{BASE}/{RID}/evaluations", json={}).json()["evaluation"]
    attempt = body["latest_attempt"]
    assert attempt["run_status"] == "failed" and attempt["error_message"] == api._TECHNICAL_MESSAGES["gemini"]
    assert TOKEN not in str(body) and body["current"] is None


def test_legacy_only_syllabi_are_reported_for_a_manual_start(client, history, agents):
    fake = history()
    fake.sources[RID] = {"old": "legacy_import", "new": "legacy_import"}
    calls = agents(outcome())
    body = client.get(f"{BASE}/{RID}/evaluation").json()["evaluation"]
    assert body["auto_run_eligible"] is False and body["first_run_eligible"] is True
    assert body["manual_start_reason"] == "legacy_syllabi" and calls == []
    body = client.post(f"{BASE}/{RID}/evaluations", json={"rerun": False}).json()["evaluation"]
    assert body["outcome"] == "started" and calls == [(RID, TOKEN)]


def test_database_errors_are_503(client, monkeypatch):
    def broken(request_id):
        raise OperationalError("SELECT", {}, Exception("x"))
    monkeypatch.setattr(api, "read_evaluation", broken)
    assert client.get(f"{BASE}/{RID}/evaluation").status_code == 503

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.agents.raise_capacity_eligibility.exceptions import NotRaiseCapacityRequestError, RequestNotFoundError
from app.agents.raise_capacity_eligibility.service import EnsureOutcome, RunInProgressError, summarize_runs
from app.api import raise_capacity_review as api
from app.config import get_settings
from app.core import auth
from app.main import app


def run(run_id, status, gemini="ok", interrupted=False):
    return {"id": run_id, "run_status": status, "gemini_status": gemini if status == "completed" else None,
            "interrupted": interrupted}


# -- run summary -------------------------------------------------------------

def test_failed_rerun_keeps_the_last_successful_result_and_reports_the_failure():
    summary = summarize_runs([run(3, "failed"), run(2, "completed"), run(1, "completed")])
    assert summary["current"]["id"] == 2
    assert summary["latest_attempt"]["id"] == 3


def test_newest_success_is_current_with_no_separate_attempt():
    summary = summarize_runs([run(2, "completed"), run(1, "failed")])
    assert summary["current"]["id"] == 2
    assert summary["latest_attempt"] is None


def test_gemini_unavailable_rerun_does_not_replace_a_gemini_decision():
    summary = summarize_runs([run(2, "completed", gemini="unavailable"), run(1, "completed")])
    assert summary["current"]["id"] == 1
    assert summary["latest_attempt"]["id"] == 2


def test_only_unavailable_result_is_still_shown():
    summary = summarize_runs([run(1, "completed", gemini="unavailable")])
    assert summary["current"]["id"] == 1


def test_running_and_interrupted_runs():
    assert summarize_runs([run(1, "running")])["in_progress"] is True
    stale = summarize_runs([run(1, "running", interrupted=True)])
    assert stale["in_progress"] is False
    assert stale["latest_attempt"]["id"] == 1


# -- staff authentication ------------------------------------------------------

class FakeSupabaseAuth(BaseHTTPRequestHandler):
    users = {"staff-token": "00000000-0000-0000-0000-0000000000b1",
             "student-token": "00000000-0000-0000-0000-0000000000a1"}

    def do_GET(self):  # noqa: N802
        token = self.headers.get("Authorization", "").removeprefix("Bearer ")
        ok = self.path == "/auth/v1/user" and self.headers.get("apikey") == "anon-key" and token in self.users
        body = json.dumps({"id": self.users[token]} if ok else {"msg": "invalid"}).encode()
        self.send_response(200 if ok else 401)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture
def supabase_auth(monkeypatch):
    server = HTTPServer(("127.0.0.1", 0), FakeSupabaseAuth)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setenv("SUPABASE_URL", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    get_settings.cache_clear()
    monkeypatch.setattr(auth, "find_staff", lambda uid: 100001 if uid.endswith("b1") else None)
    yield
    server.shutdown()


def test_staff_session_is_accepted(supabase_auth):
    staff = auth.require_staff("Bearer staff-token")
    assert staff.staff_id == 100001


@pytest.mark.parametrize(("header", "code"), [
    (None, 401), ("staff-token", 401), ("Bearer ", 401), ("Bearer forged", 401), ("Bearer student-token", 403),
])
def test_missing_invalid_and_non_staff_sessions_are_refused(supabase_auth, header, code):
    with pytest.raises(HTTPException) as exc:
        auth.require_staff(header)
    assert exc.value.status_code == code


def test_unreachable_auth_service_is_503(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    get_settings.cache_clear()
    with pytest.raises(HTTPException) as exc:
        auth.require_staff("Bearer staff-token")
    assert exc.value.status_code == 503


# -- API -----------------------------------------------------------------------

STAFF = auth.StaffIdentity(auth_user_id="00000000-0000-0000-0000-0000000000b1", staff_id=100001)
REVIEW = {"request": {}, "student": {}, "transcript": [], "evaluation": {"current": None}}


@pytest.fixture
def client():
    app.dependency_overrides[auth.require_staff] = lambda: STAFF
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_routes_require_a_session():
    unauthenticated = TestClient(app)
    assert unauthenticated.get("/api/staff/raise-capacity/X/review").status_code == 401
    assert unauthenticated.post("/api/staff/raise-capacity/X/evaluations", json={}).status_code == 401
    assert unauthenticated.get("/api/health").json() == {"status": "ok"}


def test_review_and_first_open(client, monkeypatch):
    calls = []
    monkeypatch.setattr(api, "get_review", lambda rid: {**REVIEW, "evaluation": {"current": None}})
    monkeypatch.setattr(api, "ensure_evaluation",
                        lambda rid, staff, rerun: calls.append((rid, staff.staff_id, rerun)) or EnsureOutcome(True, False))
    assert client.get("/api/staff/raise-capacity/STUD_RSCA_RSCA_000001/review").status_code == 200
    response = client.post("/api/staff/raise-capacity/STUD_RSCA_RSCA_000001/evaluations", json={})
    assert response.status_code == 200
    assert response.json()["evaluation"]["started_by_this_call"] is True
    client.post("/api/staff/raise-capacity/STUD_RSCA_RSCA_000001/evaluations", json={"rerun": True})
    assert calls == [("STUD_RSCA_RSCA_000001", 100001, False), ("STUD_RSCA_RSCA_000001", 100001, True)]


@pytest.mark.parametrize("error", [RequestNotFoundError("x"), NotRaiseCapacityRequestError("x")])
def test_unknown_or_other_type_request_is_404(client, monkeypatch, error):
    def boom(*args, **kwargs):
        raise error

    monkeypatch.setattr(api, "get_review", boom)
    monkeypatch.setattr(api, "ensure_evaluation", boom)
    assert client.get("/api/staff/raise-capacity/X/review").status_code == 404
    assert client.post("/api/staff/raise-capacity/X/evaluations", json={"rerun": True}).status_code == 404


def test_rerun_while_running_is_409(client, monkeypatch):
    def busy(*args, **kwargs):
        raise RunInProgressError("running")

    monkeypatch.setattr(api, "ensure_evaluation", busy)
    assert client.post("/api/staff/raise-capacity/X/evaluations", json={"rerun": True}).status_code == 409

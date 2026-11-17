"""Staff API for Course Equivalency syllabi: authentication before the body is read,
authorization, path validation, multipart limits, the error format, and the real
service on the in-memory registry and bucket. No network, no database."""

import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from starlette.requests import Request

from app.api import course_equivalency_syllabi as api
from app.core import auth, storage
from app.course_equivalency import syllabus_service as service
from app.course_equivalency.syllabus_files import MAX_FILE_BYTES
from app.main import app

from .fakes import CLOSED_RID, PDF_MIME, RID, SESSION, STAFF, STAFF_ID, TOKEN, FakeRegistry, make_docx, make_pdf

BASE = f"/api/staff/course-equivalency/{RID}/syllabi"


@pytest.fixture
def fake(monkeypatch):
    registry = FakeRegistry()
    monkeypatch.setattr(service, "repo", registry)
    monkeypatch.setattr(service, "read_only", registry.transaction)
    monkeypatch.setattr(service, "write_transaction", registry.transaction)
    monkeypatch.setattr(storage, "upload_object",
                        lambda bucket, path, data, ctype, token: registry.store(bucket, path, data, ctype, token))
    monkeypatch.setattr(service, "_sleep", lambda s: None)
    return registry


@pytest.fixture
def client(fake):
    app.dependency_overrides[auth.require_staff] = lambda: STAFF
    app.dependency_overrides[auth.require_staff_session] = lambda: SESSION
    yield TestClient(app)
    app.dependency_overrides.clear()


def pdf_file(name="Calculus I.pdf", data=None):
    return {"file": (name, make_pdf() if data is None else data, "application/pdf")}


# ------------------------------------------------------------------ authentication / authorization
def test_upload_requires_a_session_and_never_reads_the_body_first(fake, monkeypatch):
    def must_not_parse(self, **kwargs):
        raise AssertionError("the body was read before authentication")
    monkeypatch.setattr(Request, "form", must_not_parse)
    response = TestClient(app).post(f"{BASE}/old", files=pdf_file())
    assert response.status_code == 401
    assert fake.objects == {}


def test_get_requires_a_session(fake):
    assert TestClient(app).get(BASE).status_code == 401


def test_non_staff_are_refused(fake, monkeypatch):
    monkeypatch.setattr(auth, "verify_session", lambda token: "11111111-1111-4111-8111-111111111111")
    monkeypatch.setattr(auth, "find_staff", lambda uid: None)
    headers = {"Authorization": "Bearer student-token"}
    assert TestClient(app).get(BASE, headers=headers).status_code == 403
    assert TestClient(app).post(f"{BASE}/new", files=pdf_file(), headers=headers).status_code == 403
    assert fake.objects == {}


# ------------------------------------------------------------------ path validation
@pytest.mark.parametrize("url", [
    "/api/staff/course-equivalency/STUD_RSCA_RSCA_000072/syllabi/old",
    "/api/staff/course-equivalency/STUD_EQVO_ECTU_00013/syllabi/old",
    "/api/staff/course-equivalency/stud_eqvo_ectu_000139/syllabi/old",
    f"{BASE}/both",
    f"{BASE}/OLD",
])
def test_invalid_targets(client, fake, url):
    assert client.post(url, files=pdf_file()).status_code == 422
    assert fake.objects == {}


# ------------------------------------------------------------------ success
def test_upload_old_then_new(client, fake):
    first = client.post(f"{BASE}/old", files=pdf_file(), data={"replaces": "none"})
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["side"] == "old" and body["ready"] is False and body["superseded_syllabus_id"] is None
    assert body["syllabus"]["uploaded_by_staff_id"] == STAFF_ID and body["syllabus"]["mime_type"] == PDF_MIME
    second = client.post(f"{BASE}/new", files={"file": ("Calculus I.docx", make_docx(), "application/msword")})
    assert second.status_code == 200 and second.json()["ready"] is True
    state = client.get(BASE).json()
    assert state["ready"] is True and state["sides"]["old"]["current"]["syllabus_id"] == body["syllabus"]["syllabus_id"]
    assert TOKEN not in first.text + second.text + str(state)


def test_declared_content_type_is_ignored_content_decides(client, fake):
    response = client.post(f"{BASE}/old", files={"file": ("a.pdf", b"not a pdf at all", "application/pdf")})
    assert response.status_code == 415 and response.json()["detail"]["code"] == "unsupported_type"


def test_replacement_with_optimistic_concurrency(client, fake):
    legacy = fake.add_row("old")
    ok = client.post(f"{BASE}/old", files=pdf_file(), data={"replaces": legacy["syllabus_id"]})
    assert ok.status_code == 200 and ok.json()["superseded_syllabus_id"] == legacy["syllabus_id"]
    stale = client.post(f"{BASE}/old", files=pdf_file(), data={"replaces": legacy["syllabus_id"]})
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "syllabus_changed"


# ------------------------------------------------------------------ multipart limits
def test_staff_id_cannot_be_supplied_by_the_client(client, fake):
    response = client.post(f"{BASE}/old", files=pdf_file(), data={"staff_id": "100001"})
    assert response.status_code == 400 and response.json()["detail"]["code"] == "invalid_form"
    assert fake.objects == {}


def test_missing_file(client, fake):
    response = client.post(f"{BASE}/old", files={"replaces": (None, "none")})
    assert response.status_code == 422 and response.json()["detail"]["code"] == "file_missing"


def test_two_files_refused(client, fake):
    files = [("file", ("a.pdf", make_pdf(), "application/pdf")), ("file", ("b.pdf", make_pdf(), "application/pdf"))]
    assert client.post(f"{BASE}/old", files=files).status_code == 400
    assert fake.objects == {}


def test_file_in_another_field_refused(client, fake):
    response = client.post(f"{BASE}/old", files={"document": ("a.pdf", make_pdf(), "application/pdf")})
    assert response.status_code == 400 and fake.objects == {}


def test_oversized_text_field_refused(client, fake):
    response = client.post(f"{BASE}/old", files=pdf_file(), data={"replaces": "x" * 5000})
    assert response.status_code == 400 and fake.objects == {}


def test_not_multipart(client, fake):
    response = client.post(f"{BASE}/old", json={"file": "x"})
    assert response.status_code == 415 and response.json()["detail"]["code"] == "invalid_form"


def test_length_required(client, fake):
    def chunks():
        yield b"--x\r\n"
    response = client.post(f"{BASE}/old", content=chunks(),
                           headers={"Content-Type": "multipart/form-data; boundary=x"})
    assert response.status_code == 411 and response.json()["detail"]["code"] == "length_required"


def test_declared_body_too_large(client, fake, monkeypatch):
    monkeypatch.setattr(api, "MAX_BODY_BYTES", 1000)
    response = client.post(f"{BASE}/old", files=pdf_file(data=make_pdf(b"x" * 2000)))
    assert response.status_code == 413 and fake.objects == {}


def test_file_over_10_mb(client, fake):
    data = make_pdf() + b"0" * (MAX_FILE_BYTES - len(make_pdf()) + 1)
    response = client.post(f"{BASE}/old", files=pdf_file(data=data))
    assert response.status_code == 413 and response.json()["detail"]["code"] == "file_too_large"
    assert fake.objects == {}


# ------------------------------------------------------------------ error format and safe messages
def test_closed_request(client, fake):
    response = client.post(f"/api/staff/course-equivalency/{CLOSED_RID}/syllabi/old", files=pdf_file())
    assert response.status_code == 409
    assert response.json()["detail"] == {"code": "request_not_in_progress",
                                         "message": "Syllabi can only be uploaded while the request is In Progress."}


def test_get_unknown_request(client, fake):
    response = client.get("/api/staff/course-equivalency/STUD_EQVO_ECTU_999999/syllabi")
    assert response.status_code == 404 and response.json()["detail"]["code"] == "request_not_found"


def test_database_errors_are_sanitized(client, fake, monkeypatch, caplog):
    def broken(*args, **kwargs):
        raise OperationalError("SELECT secret_sql", {"rid": RID}, Exception("password=hunter2"))
    monkeypatch.setattr(service, "get_syllabi", broken)
    with caplog.at_level(logging.DEBUG):
        response = client.get(BASE)
    assert response.status_code == 503 and response.json()["detail"]["code"] == "database_unavailable"
    assert "secret_sql" not in response.text and "hunter2" not in response.text and "hunter2" not in caplog.text


def test_storage_refusal_reaches_staff_without_the_token(client, fake, monkeypatch, caplog):
    def refused(*args):
        raise storage.StorageAccessDeniedError("Supabase Storage refused the upload (403).")
    monkeypatch.setattr(storage, "upload_object", refused)
    with caplog.at_level(logging.DEBUG):
        response = client.post(f"{BASE}/old", files=pdf_file())
    assert response.status_code == 403 and response.json()["detail"]["code"] == "upload_refused"
    assert TOKEN not in response.text and TOKEN not in caplog.text

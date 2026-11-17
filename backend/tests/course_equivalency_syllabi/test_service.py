"""syllabus_service: validation, pre-checks, Storage upload AS the staff member,
registration with the session's Staff_ID, retries that never upload twice,
optimistic concurrency atomic with registration, and the current syllabus
preserved on every failure. In-memory registry and bucket; no network, no DB."""

import hashlib
import logging
import re
from contextlib import contextmanager

import pytest
from sqlalchemy.exc import OperationalError

from app.core import storage
from app.core.database import DatabaseUnavailableError
from app.course_equivalency import syllabus_service as service
from app.course_equivalency.syllabus_service import SyllabusServiceError

from .fakes import (
    CLOSED_RID, DOCX_MIME, OTHER_TYPE_RID, PDF_MIME, RID, SESSION, STAFF_ID, TOKEN, FakeRegistry, db_error,
    make_docx, make_pdf,
)

PATH_RE = re.compile(r"^STUD_EQVO_ECTU_000139/(old|new)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|docx)$")


@pytest.fixture
def fake(monkeypatch):
    registry = FakeRegistry()
    registry.uploads = []
    registry.sleeps = []

    def upload(bucket, path, data, content_type, token):
        registry.uploads.append((bucket, path, len(data), content_type, token))
        registry.store(bucket, path, data, content_type, token)

    monkeypatch.setattr(service, "repo", registry)
    monkeypatch.setattr(service, "read_only", registry.transaction)
    monkeypatch.setattr(service, "write_transaction", registry.transaction)
    monkeypatch.setattr(storage, "upload_object", upload)
    monkeypatch.setattr(service, "_sleep", registry.sleeps.append)
    return registry


def upload(side="old", data=None, name=None, replaces=None, rid=RID):
    data = make_pdf() if data is None else data
    name = name or ("Calculus I.pdf" if data.startswith(b"%PDF") else "Calculus I.docx")
    return service.upload_syllabus(request_id=rid, side=side, file_name=name, data=data, session=SESSION,
                                   replaces=replaces)


def refusal(**kwargs):
    with pytest.raises(SyllabusServiceError) as info:
        upload(**kwargs)
    return info.value


def registrations(fake):
    return [c for c in fake.calls if c[0] == "register"]


# ------------------------------------------------------------------ success paths
def test_first_upload_registers_with_session_staff_and_exact_metadata(fake):
    data = make_pdf()
    result = upload("old", data, "C:\\fakepath\\Calculus  I.pdf")
    assert len(fake.uploads) == 1
    bucket, path, size, mime, token = fake.uploads[0]
    assert (bucket, size, mime, token) == ("course-syllabi", len(data), PDF_MIME, TOKEN)
    assert PATH_RE.fullmatch(path) and path.startswith(f"{RID}/old/") and path.endswith(".pdf")
    assert registrations(fake)[0][1:] == (RID, "old", path, "Calculus I.pdf", PDF_MIME, len(data),
                                          hashlib.sha256(data).hexdigest(), STAFF_ID)
    row = result["syllabus"]
    assert row["is_current"] and row["source"] == "staff_upload" and row["uploaded_by_staff_id"] == STAFF_ID
    assert row["sha256"] == hashlib.sha256(data).hexdigest() and row["storage_path"] == path
    assert result["superseded_syllabus_id"] is None and result["ready"] is False
    assert isinstance(row["uploaded_at"], str)                      # JSON-ready


def test_both_sides_make_the_request_ready(fake):
    assert upload("old")["ready"] is False
    result = upload("new", make_docx())
    assert result["ready"] is True and result["syllabus"]["mime_type"] == DOCX_MIME
    assert fake.uploads[1][1].endswith(".docx")


def test_replacement_supersedes_and_keeps_history(fake):
    first = upload("old")["syllabus"]["syllabus_id"]
    result = upload("old", make_pdf(b"version 2"), replaces=first)
    assert result["superseded_syllabus_id"] == first
    old_rows = [r for r in fake.rows if r["side"] == "old"]
    assert len(old_rows) == 2 and sum(r["is_current"] for r in old_rows) == 1
    assert fake.current("old")["syllabus_id"] == result["syllabus"]["syllabus_id"]


def test_replacing_a_legacy_syllabus(fake):
    legacy = fake.add_row("old")
    result = upload("old", replaces=legacy["syllabus_id"].upper())     # case-insensitive
    assert result["superseded_syllabus_id"] == legacy["syllabus_id"]


def test_replaces_none_when_nothing_is_current(fake):
    assert upload("new", make_docx(), replaces="none")["superseded_syllabus_id"] is None


def test_upload_without_replaces_still_replaces(fake):
    legacy = fake.add_row("new")
    assert upload("new")["superseded_syllabus_id"] == legacy["syllabus_id"]


# ------------------------------------------------------------------ refusals before anything is stored
@pytest.mark.parametrize("kwargs,status,code", [
    ({"rid": "STUD_EQVO_ECTU_999999"}, 404, "request_not_found"),
    ({"rid": OTHER_TYPE_RID}, 422, "invalid_target"),
    ({"rid": CLOSED_RID}, 409, "request_not_in_progress"),
    ({"side": "both"}, 422, "invalid_target"),
    ({"data": make_pdf(encrypted=True)}, 422, "encrypted_pdf"),
    ({"data": make_docx(macro_part=True)}, 422, "macro_docx"),
    ({"data": b"hello", "name": "a.pdf"}, 415, "unsupported_type"),
    ({"data": make_pdf(), "name": "a.docx"}, 422, "extension_mismatch"),
    ({"data": b""}, 422, "empty_file"),
    ({"replaces": "not-a-uuid"}, 422, "invalid_replaces"),
])
def test_refusals_store_nothing(fake, kwargs, status, code):
    err = refusal(**kwargs)
    assert (err.status, err.code) == (status, code)
    assert fake.uploads == [] and registrations(fake) == []


def test_other_request_type_reported_by_precheck(fake, monkeypatch):
    monkeypatch.setattr(service, "REQUEST_ID_PATTERN", re.compile(r".*"))     # reach the database check
    err = refusal(rid=OTHER_TYPE_RID)
    assert (err.status, err.code) == (404, "not_course_equivalency") and fake.uploads == []


def test_version_cap_refused_before_upload(fake):
    for _ in range(20):
        fake.add_row("old", source="staff_upload", staff=STAFF_ID)
    err = refusal()
    assert (err.status, err.code) == (409, "too_many_versions") and fake.uploads == []


def test_stale_replaces_refused_before_upload(fake):
    fake.add_row("old")
    err = refusal(replaces="11111111-1111-4111-8111-111111111111")
    assert (err.status, err.code) == (409, "syllabus_changed") and fake.uploads == []
    err = refusal(replaces="none")
    assert err.code == "syllabus_changed" and fake.uploads == []


# ------------------------------------------------------------------ optimistic concurrency (atomic with registration)
def test_replacement_that_lost_the_race_is_rolled_back(fake, caplog):
    seen = fake.add_row("old")

    def someone_else_replaces(registry):         # runs inside the registration, before our supersede
        registry.add_row("old", source="staff_upload", staff=100001)
    fake.before_register = someone_else_replaces
    with caplog.at_level(logging.WARNING):
        err = refusal(replaces=seen["syllabus_id"])
    assert (err.status, err.code) == (409, "syllabus_changed")
    # Our registration was rolled back: the version that won the race stays current, ours is not registered.
    assert fake.current("old")["uploaded_by_staff_id"] == 100001
    assert not any(r["storage_path"] == fake.uploads[0][1] for r in fake.rows)
    assert "NOT registered" in caplog.text and TOKEN not in caplog.text


# ------------------------------------------------------------------ registration failures keep the current syllabus
@pytest.mark.parametrize("code,status,out", [
    ("request_not_in_progress", 409, "request_not_in_progress"),
    ("too_many_versions", 409, "too_many_versions"),
    ("staff_not_authorized", 403, "staff_not_authorized"),
    ("request_not_found", 404, "request_not_found"),
    ("storage_object_owner_mismatch", 502, "registration_failed"),
    ("storage_object_not_found", 502, "registration_failed"),
    ("storage_object_size_mismatch", 502, "registration_failed"),
    ("invalid_storage_path", 502, "registration_failed"),
    ("something_unexpected", 502, "registration_failed"),
])
def test_registration_refusal_preserves_current(fake, caplog, code, status, out):
    legacy = fake.add_row("old")
    fake.register_failures = [db_error(code)]
    with caplog.at_level(logging.WARNING):
        err = refusal(replaces=legacy["syllabus_id"])
    assert (err.status, err.code) == (status, out)
    assert fake.current("old")["syllabus_id"] == legacy["syllabus_id"]
    assert len(fake.uploads) == 1 and len(registrations(fake)) == 1        # refusals are not retried
    assert "NOT registered" in caplog.text and TOKEN not in caplog.text


def test_status_change_after_upload_is_refused_by_registration(fake):
    legacy = fake.add_row("old")

    def decided(registry):
        registry.requests[RID] = ("Course Equivalency", "Completed")
    fake.before_register = decided
    err = refusal()
    assert err.code == "request_not_in_progress"
    assert fake.current("old")["syllabus_id"] == legacy["syllabus_id"]


@pytest.mark.parametrize("transient", [
    lambda: DatabaseUnavailableError("down"),
    lambda: OperationalError("SELECT", {}, Exception("connection reset")),
])
def test_transient_failures_retry_registration_only(fake, transient):
    fake.register_failures = [transient(), transient()]
    result = upload()
    assert len(fake.uploads) == 1                                    # never uploaded twice
    assert len(registrations(fake)) == 3
    assert fake.sleeps == list(service.RETRY_DELAYS_SECONDS)
    assert result["syllabus"]["storage_path"] == fake.uploads[0][1]


def test_retry_after_an_unacknowledged_commit_reports_success(fake, monkeypatch):
    """The first registration commits on the server but its reply is lost; the retry
    takes the lock again, finds the object already registered (without calling the
    registration function again) and reports the committed result."""
    legacy = fake.add_row("old")
    real_register = fake.register
    attempts = []

    class CommittedButLost(DatabaseUnavailableError):
        pass

    def register(conn, **kwargs):
        attempts.append(kwargs["storage_path"])
        sid = real_register(conn, **kwargs)
        if len(attempts) == 1:
            raise CommittedButLost("connection lost after commit")
        return sid

    @contextmanager
    def keeps_committed_state():
        fake._tx_superseded = []
        yield object()                          # no rollback: the commit already happened

    fake.register = register
    monkeypatch.setattr(service, "write_transaction", keeps_committed_state)
    result = upload()
    assert len(fake.uploads) == 1 and len(attempts) == 1
    assert [e[0] for e in fake.lock_events].count("acquired") == 1      # the custom transaction never released it
    assert result["syllabus"]["storage_path"] == fake.uploads[0][1]
    assert result["superseded_syllabus_id"] == legacy["syllabus_id"]
    assert len([r for r in fake.rows if r["side"] == "old" and r["is_current"]]) == 1


def test_database_unavailable_after_all_attempts(fake, caplog):
    legacy = fake.add_row("old")
    fake.register_failures = [DatabaseUnavailableError("down")] * 3
    with caplog.at_level(logging.WARNING):
        err = refusal()
    assert (err.status, err.code) == (503, "registration_unavailable")
    assert len(fake.uploads) == 1 and fake.current("old")["syllabus_id"] == legacy["syllabus_id"]
    assert "NOT registered" in caplog.text


# ------------------------------------------------------------------ Storage failures (nothing registered)
@pytest.mark.parametrize("exc,status,code", [
    (storage.StorageAccessDeniedError("denied"), 403, "upload_refused"),
    (storage.StorageRejectedError("big", "too_large"), 413, "file_too_large"),
    (storage.StorageRejectedError("type", "type"), 415, "unsupported_type"),
    (storage.StorageRejectedError("no"), 422, "upload_rejected"),
    (storage.StorageNotConfiguredError("x"), 503, "storage_not_configured"),
    (storage.StorageUnavailableError("x"), 503, "storage_unavailable"),
])
def test_storage_failures_register_nothing(fake, monkeypatch, exc, status, code):
    legacy = fake.add_row("old")

    def failing(*args):
        raise exc
    monkeypatch.setattr(storage, "upload_object", failing)
    err = refusal()
    assert (err.status, err.code) == (status, code)
    assert registrations(fake) == []
    assert fake.current("old")["syllabus_id"] == legacy["syllabus_id"]
    assert TOKEN not in err.message


def test_name_collision_retries_with_a_new_uuid(fake, monkeypatch):
    paths = []

    def collide_once(bucket, path, data, content_type, token):
        paths.append(path)
        if len(paths) == 1:
            raise storage.StorageConflictError("exists")
        fake.store(bucket, path, data, content_type, token)
    monkeypatch.setattr(storage, "upload_object", collide_once)
    result = upload()
    assert len(paths) == 2 and paths[0] != paths[1]
    assert result["syllabus"]["storage_path"] == paths[1]


def test_repeated_collision_gives_up(fake, monkeypatch):
    def always(*args):
        raise storage.StorageConflictError("exists")
    monkeypatch.setattr(storage, "upload_object", always)
    assert refusal().code == "storage_unavailable"


# ------------------------------------------------------------------ the read endpoint's service
def test_get_syllabi_structure(fake):
    legacy_old = fake.add_row("old")
    fake.add_row("new")
    new_old = upload("old", replaces=legacy_old["syllabus_id"])["syllabus"]
    calls_before = len(registrations(fake))
    state = service.get_syllabi(RID)
    assert len(registrations(fake)) == calls_before                       # read-only
    assert state["request_status"] == "In Progress" and state["can_upload"] and state["ready"]
    old = state["sides"]["old"]
    assert old["current"]["syllabus_id"] == new_old["syllabus_id"]
    assert [v["syllabus_id"] for v in old["versions"]] == [new_old["syllabus_id"], legacy_old["syllabus_id"]]
    assert state["limits"] == {"max_bytes": 10485760, "max_versions_per_side": 20,
                               "allowed_types": [PDF_MIME, DOCX_MIME]}


def test_get_syllabi_closed_and_empty(fake):
    state = service.get_syllabi(CLOSED_RID)
    assert state["can_upload"] is False and state["ready"] is False
    assert state["sides"]["old"] == {"current": None, "versions": []}


@pytest.mark.parametrize("rid,code", [("STUD_EQVO_ECTU_999999", "request_not_found"),
                                      (OTHER_TYPE_RID, "not_course_equivalency")])
def test_get_syllabi_unknown_or_other_type(fake, rid, code):
    with pytest.raises(SyllabusServiceError) as info:
        service.get_syllabi(rid)
    assert (info.value.status, info.value.code) == (404, code)


def test_error_templates_are_not_shared_between_raises(fake):
    first = refusal(rid=CLOSED_RID)
    second = refusal(rid=CLOSED_RID)
    assert first is not second and first is not service.NOT_IN_PROGRESS

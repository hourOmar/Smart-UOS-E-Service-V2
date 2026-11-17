"""Per-(request, side) upload serialization with a transaction-scoped advisory lock:
simultaneous uploads (real threads), independence of other sides and requests,
the lock-wait budget, and lock release / no open transaction after every kind of
success, refusal, failure and timeout. In-memory registry; no network, no DB."""

import threading
import time

import pytest

from app.core import storage
from app.core.database import DatabaseUnavailableError
from app.course_equivalency import syllabus_service as service
from app.course_equivalency.syllabus_service import SyllabusServiceError

from .fakes import RID, RID2, SESSION, FakeRegistry, db_error, make_docx, make_pdf


@pytest.fixture
def fake(monkeypatch):
    registry = FakeRegistry()
    registry.uploads = []
    registry.upload_hook = None                     # hook(path) runs inside the Storage call (lock held)

    def upload(bucket, path, data, content_type, token):
        registry.uploads.append(path)
        if registry.upload_hook:
            registry.upload_hook(path)
        registry.store(bucket, path, data, content_type, token)

    monkeypatch.setattr(service, "repo", registry)
    monkeypatch.setattr(service, "read_only", registry.transaction)
    monkeypatch.setattr(service, "write_transaction", registry.transaction)
    monkeypatch.setattr(storage, "upload_object", upload)
    monkeypatch.setattr(service, "_sleep", lambda seconds: time.sleep(0.005))
    return registry


def upload(side="old", replaces=None, rid=RID, data=None):
    data = data or (make_pdf(f"{side} {time.time_ns()}".encode()) if side == "old" else make_docx())
    name = "s.pdf" if data.startswith(b"%PDF") else "s.docx"
    return service.upload_syllabus(request_id=rid, side=side, file_name=name, data=data, session=SESSION,
                                   replaces=replaces)


def in_thread(fn, *args, **kwargs):
    out = {}

    def target():
        try:
            out["result"] = fn(*args, **kwargs)
        except BaseException as exc:                # noqa: BLE001
            out["error"] = exc
    thread = threading.Thread(target=target)
    thread.start()
    return thread, out


def clean(fake):
    """No lock held and no transaction left open."""
    return fake.locks == {} and fake.open_transactions == 0


def busy_events(fake, key):
    return [e for e in fake.lock_events if e[0] == "busy" and e[1] == key]


# ------------------------------------------------------------------ simultaneous uploads
def test_same_side_is_serialized_and_the_loser_never_uploads(fake):
    v1 = upload("old")["syllabus"]["syllabus_id"]
    gate, inside = threading.Event(), threading.Event()

    def hold(path):
        inside.set()
        assert gate.wait(5)
    fake.upload_hook = hold
    first, first_out = in_thread(upload, "old", replaces=v1)
    assert inside.wait(5)                                   # first holds the lock inside its Storage call
    fake.upload_hook = None
    second, second_out = in_thread(upload, "old", replaces=v1)
    deadline = time.time() + 5
    while not busy_events(fake, f"{RID}:old") and time.time() < deadline:
        time.sleep(0.005)
    assert busy_events(fake, f"{RID}:old"), "the second upload did not wait for the lock"
    assert len(fake.uploads) == 2                           # v1 + first; second has NOT uploaded
    gate.set()
    first.join(5), second.join(5)
    assert first_out["result"]["superseded_syllabus_id"] == v1
    err = second_out["error"]
    assert isinstance(err, SyllabusServiceError) and err.code == "syllabus_changed"
    assert len(fake.uploads) == 2                           # the loser was refused BEFORE uploading: no orphan
    assert fake.current("old")["syllabus_id"] == first_out["result"]["syllabus"]["syllabus_id"]
    assert clean(fake)


def test_same_side_without_replaces_runs_one_after_the_other(fake):
    gate, inside = threading.Event(), threading.Event()

    def hold(path):
        inside.set()
        assert gate.wait(5)
    fake.upload_hook = hold
    first, first_out = in_thread(upload, "new")
    assert inside.wait(5)
    fake.upload_hook = None
    second, second_out = in_thread(upload, "new")
    time.sleep(0.05)
    assert "result" not in second_out and len(fake.uploads) == 1     # waiting, not uploading
    gate.set()
    first.join(5), second.join(5)
    a, b = first_out["result"], second_out["result"]
    assert b["superseded_syllabus_id"] == a["syllabus"]["syllabus_id"]
    assert [r["is_current"] for r in fake.rows if r["side"] == "new"].count(True) == 1
    assert clean(fake)


@pytest.mark.parametrize("other", [{"side": "new"}, {"side": "old", "rid": RID2}])
def test_other_sides_and_requests_are_independent(fake, other):
    gate, inside = threading.Event(), threading.Event()

    def hold(path):
        if path.startswith(f"{RID}/old/"):
            inside.set()
            assert gate.wait(5)
    fake.upload_hook = hold
    blocked, blocked_out = in_thread(upload, "old")
    assert inside.wait(5)
    result = upload(**other)                                 # completes while the first still holds its lock
    assert result["syllabus"]["is_current"] and "result" not in blocked_out
    gate.set()
    blocked.join(5)
    assert blocked_out["result"]["syllabus"]["is_current"]
    assert clean(fake)


def test_many_simultaneous_replacements_one_winner_no_orphans(fake):
    v1 = upload("old")["syllabus"]["syllabus_id"]
    start = threading.Barrier(6)

    def racer():
        start.wait(5)
        return upload("old", replaces=v1)
    threads = [in_thread(racer) for _ in range(6)]
    for thread, _ in threads:
        thread.join(10)
    outcomes = ["ok" if "result" in out else out["error"].code for _, out in threads]
    assert outcomes.count("ok") == 1 and outcomes.count("syllabus_changed") == 5
    assert len(fake.uploads) == 2                           # v1 + the single winner: losers uploaded nothing
    assert set(fake.objects) == {r["storage_path"] for r in fake.rows}   # every stored object is registered
    assert clean(fake)


# ------------------------------------------------------------------ lock wait budget
def test_lock_wait_gives_up_with_upload_in_progress(fake, monkeypatch):
    fake.locks[f"{RID}:old"] = "another-session"            # held by another transaction
    clock = iter(range(0, 1000, 5))
    monkeypatch.setattr(service, "_monotonic", lambda: float(next(clock)))
    with pytest.raises(SyllabusServiceError) as info:
        upload("old")
    assert (info.value.status, info.value.code) == (409, "upload_in_progress")
    assert fake.uploads == [] and not any(c[0] == "register" for c in fake.calls)
    assert fake.locks == {f"{RID}:old": "another-session"}  # the other session's lock is untouched
    assert fake.open_transactions == 0


def test_waiting_upload_proceeds_once_the_lock_is_free(fake, monkeypatch):
    fake.locks[f"{RID}:old"] = "another-session"
    polls = []

    def sleep(seconds):
        polls.append(seconds)
        if len(polls) == 3:
            del fake.locks[f"{RID}:old"]                    # the other transaction ends
    monkeypatch.setattr(service, "_sleep", sleep)
    assert upload("old")["syllabus"]["is_current"]
    assert polls == [service.LOCK_POLL_SECONDS] * 3 and clean(fake)


# ------------------------------------------------------------------ release after every outcome
def _storage_raises(exc):
    def failing(*args):
        raise exc
    return failing


@pytest.mark.parametrize("label,setup,code", [
    ("closed request", lambda f, mp: f.requests.__setitem__(RID, ("Course Equivalency", "Completed")),
     "request_not_in_progress"),
    ("version cap", lambda f, mp: [f.add_row("old", source="staff_upload", staff=100001) for _ in range(20)],
     "too_many_versions"),
    ("stale replaces", lambda f, mp: f.add_row("old"), "syllabus_changed"),
    ("storage timeout", lambda f, mp: mp.setattr(storage, "upload_object",
                                                 _storage_raises(storage.StorageUnavailableError("timeout"))),
     "storage_unavailable"),
    ("storage policy refusal", lambda f, mp: mp.setattr(storage, "upload_object",
                                                        _storage_raises(storage.StorageAccessDeniedError("403"))),
     "upload_refused"),
    ("unexpected storage crash", lambda f, mp: mp.setattr(storage, "upload_object", _storage_raises(RuntimeError("x"))),
     "upload_failed"),
    ("registration refused", lambda f, mp: setattr(f, "register_failures", [db_error("request_not_in_progress")]),
     "request_not_in_progress"),
    ("database down after upload", lambda f, mp: setattr(f, "register_failures", [DatabaseUnavailableError("down")] * 3),
     "registration_unavailable"),
    ("database down before upload", lambda f, mp: mp.setattr(f, "try_side_lock", _storage_raises(DatabaseUnavailableError("down"))),
     "database_unavailable"),
])
def test_lock_released_and_no_transaction_left_open(fake, monkeypatch, label, setup, code):
    setup(fake, monkeypatch)
    replaces = "11111111-1111-4111-8111-111111111111" if label == "stale replaces" else None
    with pytest.raises(SyllabusServiceError) as info:
        upload("old", replaces=replaces)
    assert info.value.code == code, label
    assert clean(fake), label


def test_database_down_before_upload_stores_nothing(fake, monkeypatch):
    monkeypatch.setattr(fake, "try_side_lock", _storage_raises(DatabaseUnavailableError("down")))
    with pytest.raises(SyllabusServiceError) as info:
        upload("old")
    assert info.value.status == 503 and fake.uploads == []


def test_retry_after_upload_takes_the_lock_again_and_never_uploads_twice(fake):
    fake.register_failures = [DatabaseUnavailableError("down")]
    result = upload("old")
    acquired = [e for e in fake.lock_events if e[0] == "acquired"]
    released = [e for e in fake.lock_events if e[0] == "released"]
    assert len(fake.uploads) == 1 and len(acquired) == 2 and len(released) == 2
    assert result["syllabus"]["storage_path"] == fake.uploads[0] and clean(fake)


def test_success_releases_the_lock(fake):
    upload("old")
    upload("new")
    assert clean(fake) and [e[0] for e in fake.lock_events].count("acquired") == 2


def test_upload_refused_message_mentions_incomplete_uploads(fake, monkeypatch):
    monkeypatch.setattr(storage, "upload_object", _storage_raises(storage.StorageAccessDeniedError("403")))
    with pytest.raises(SyllabusServiceError) as info:
        upload("old")
    assert "too many recent incomplete uploads" in info.value.message

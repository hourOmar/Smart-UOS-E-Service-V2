"""Offline fakes for Course Equivalency syllabus uploads: an in-memory registry that
follows app_private.register_course_syllabus (Phase 3A) closely enough to test the
backend's behaviour, transactions that roll back on error, an in-memory Storage
bucket, and builders for synthetic PDF / DOCX files. No network, no database."""

import copy
import io
import itertools
import threading
import re
import uuid
import zipfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from sqlalchemy.exc import DBAPIError

from app.core.auth import StaffIdentity, StaffSession

TOKEN = "staff-access-token-SYNTHETIC-9f8e7d6c5b4a"
STAFF_ID = 100002
STAFF = StaffIdentity(auth_user_id="00000000-0000-4000-8000-000000000002", staff_id=STAFF_ID)
SESSION = StaffSession(identity=STAFF, access_token=TOKEN)
RID = "STUD_EQVO_ECTU_000139"
RID2 = "STUD_EQVO_ECTU_000141"
CLOSED_RID = "STUD_EQVO_ECTU_000140"
OTHER_TYPE_RID = "STUD_RSCA_RSCA_000072"
PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_PATH = re.compile(r"^(STUD_EQVO_ECTU_[0-9]{6})/(old|new)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|docx)$")


# ------------------------------------------------------------------ synthetic files
def make_pdf(body: bytes = b"Course syllabus: Calculus I", *, encrypted: bool = False, eof: bool = True) -> bytes:
    trailer = b"trailer\n<< /Root 1 0 R" + (b" /Encrypt 5 0 R" if encrypted else b"") + b" >>\n"
    return (b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n" + body + b"\n" + trailer
            + (b"%%EOF\n" if eof else b""))


DOCX_MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
DOCM_MAIN = "application/vnd.ms-word.document.macroEnabled.main+xml"
DOTX_MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"


def make_docx(*, main_type: str = DOCX_MAIN, document: bool = True, macro_part: bool = False,
              encrypted_flag: bool = False, bomb: bool = False, extra_entries: int = 0) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml",
                         '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                         f'<Override PartName="/word/document.xml" ContentType="{main_type}"/></Types>')
        archive.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships/>')
        if document:
            archive.writestr("word/document.xml", '<?xml version="1.0"?><w:document><w:body>Syllabus</w:body></w:document>')
        if macro_part:
            archive.writestr("word/vbaProject.bin", b"\x00" * 32)
        if bomb:
            archive.writestr("word/media/huge.bin", b"\x00" * (3 * 1024 * 1024), compress_type=zipfile.ZIP_DEFLATED)
        for i in range(extra_entries):
            archive.writestr(f"word/extra/{i}.xml", "<x/>")
    data = buffer.getvalue()
    if encrypted_flag:
        # zipfile cannot write encrypted entries: set the "encrypted" bit (general purpose
        # flag bit 0) of word/document.xml in the central directory, which is what readers see.
        raw = bytearray(data)
        name = b"word/document.xml"
        pos = raw.find(b"PK\x01\x02")
        while pos != -1:
            name_len = int.from_bytes(raw[pos + 28:pos + 30], "little")
            if raw[pos + 46:pos + 46 + name_len] == name:
                raw[pos + 8] |= 0x01
            pos = raw.find(b"PK\x01\x02", pos + 4)
        data = bytes(raw)
    return data


OLE_DOC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 512


# ------------------------------------------------------------------ database errors
class _Diag:
    def __init__(self, message):
        self.message_primary = message


class _Orig(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.diag = _Diag(message)


def db_error(message: str) -> DBAPIError:
    """What SQLAlchemy raises when the registration function raises `message`."""
    return DBAPIError("SELECT app_private.register_course_syllabus(...)", {}, _Orig(message))


# ------------------------------------------------------------------ registry + bucket
class FakeRegistry:
    """Requests, registry rows and Storage objects, with registration semantics of
    app_private.register_course_syllabus, and transaction-scoped advisory locks
    (pg_try_advisory_xact_lock): a lock belongs to the transaction that took it and
    is released when that transaction ends, by commit, rollback or exception. A
    rollback restores the state as it was when this transaction took its lock (what
    other sessions committed before that stays). Thread-safe for concurrency tests."""

    def __init__(self):
        self.requests = {RID: ("Course Equivalency", "In Progress"), RID2: ("Course Equivalency", "In Progress"),
                         CLOSED_RID: ("Course Equivalency", "Completed"),
                         OTHER_TYPE_RID: ("Raise Capacity", "In Progress")}
        self.staff = {100001: "uid-1", STAFF_ID: STAFF.auth_user_id}
        self.rows: list[dict] = []
        self.objects: dict[str, dict] = {}            # Storage bucket (metadata only)
        self.calls: list[tuple] = []
        self.register_failures: list[BaseException] = []   # raised by the next register() calls, in order
        self.before_register = None                    # hook(fake) run inside register() before checking
        self._clock = datetime(2026, 11, 16, 10, 0, tzinfo=timezone.utc)
        self.locks: dict[str, object] = {}            # advisory lock key -> owning transaction
        self.lock_events: list[tuple] = []            # ("acquired" | "busy" | "released", key, tx)
        self.open_transactions = 0
        self._mutex = threading.RLock()
        self._local = threading.local()
        self._tx_ids = itertools.count(1)

    # ---- helpers for tests
    def add_row(self, side, *, current=True, source="legacy_import", staff=None, request_id=RID):
        self._clock += timedelta(minutes=1)
        sid = str(uuid.uuid4())
        if current:
            for r in self.rows:
                if r["request_id"] == request_id and r["side"] == side and r["is_current"]:
                    r["is_current"], r["superseded_at"] = False, self._clock
        path = f"{request_id}/{side}_course_{sid[:8]}.pdf" if source == "legacy_import" else \
            f"{request_id}/{side}/{uuid.uuid4()}.pdf"
        row = {"syllabus_id": sid, "request_id": request_id, "side": side, "storage_path": path,
               "file_name": f"{side}.pdf", "mime_type": PDF_MIME, "size_bytes": 100, "sha256": None if
               source == "legacy_import" else "ab" * 32, "source": source, "uploaded_by_staff_id": staff,
               "uploaded_at": self._clock, "registered_at": self._clock, "is_current": current, "superseded_at": None}
        self.rows.append(row)
        return row

    def current(self, side, request_id=RID):
        return next((r for r in self.rows if r["request_id"] == request_id and r["side"] == side and r["is_current"]), None)

    # ---- transactions
    @property
    def _tx(self):
        return getattr(self._local, "tx", None) or "outside-a-transaction"

    @property
    def _tx_superseded(self):
        if not hasattr(self._local, "superseded"):
            self._local.superseded = []
        return self._local.superseded

    @_tx_superseded.setter
    def _tx_superseded(self, value):
        self._local.superseded = value

    def _snapshot(self):
        with self._mutex:
            self._local.saved = (copy.deepcopy(self.rows), dict(self.requests))

    @contextmanager
    def transaction(self):
        tx = next(self._tx_ids)
        self._local.tx, self._local.saved, self._local.superseded = tx, None, []
        with self._mutex:
            self.open_transactions += 1
        try:
            yield object()
        except BaseException:
            if self._local.saved is not None:                  # roll back this transaction's changes
                with self._mutex:
                    self.rows, self.requests = self._local.saved
            raise
        finally:
            with self._mutex:                                  # COMMIT or ROLLBACK releases xact locks
                for key in [k for k, owner in self.locks.items() if owner == tx]:
                    del self.locks[key]
                    self.lock_events.append(("released", key, tx))
                self.open_transactions -= 1
            self._local.tx = None

    def try_side_lock(self, conn, request_id, side):
        key = f"{request_id}:{side}"
        with self._mutex:
            owner = self.locks.get(key)
            if owner not in (None, self._tx):
                self.lock_events.append(("busy", key, self._tx))
                return False
            if owner is None:
                self.locks[key] = self._tx
                self.lock_events.append(("acquired", key, self._tx))
        if getattr(self._local, "saved", "none") is None:
            self._snapshot()
        return True

    # ---- repository interface (same names and signatures as syllabus_repository)
    def request_info(self, conn, request_id):
        self.calls.append(("request_info", request_id))
        return self.requests.get(request_id)

    def syllabus_rows(self, conn, request_id):
        rows = [dict(r) for r in self.rows if r["request_id"] == request_id]
        return sorted(rows, key=lambda r: (r["side"], r["uploaded_at"], r["registered_at"]))

    def side_summary(self, conn, request_id, side):
        rows = [r for r in self.rows if r["request_id"] == request_id and r["side"] == side]
        current = next((r["syllabus_id"] for r in rows if r["is_current"]), None)
        return len(rows), current

    def register(self, conn, *, request_id, side, storage_path, file_name, mime_type, size_bytes, sha256, staff_id):
        self.calls.append(("register", request_id, side, storage_path, file_name, mime_type, size_bytes, sha256,
                           staff_id))
        if self.before_register:
            # Another session's work that COMMITTED before this registration got the
            # request lock: it becomes part of the state a rollback returns to.
            hook, self.before_register = self.before_register, None
            hook(self)
            self._snapshot()
        if self.register_failures:
            raise self.register_failures.pop(0)
        info = self.requests.get(request_id)
        if info is None:
            raise db_error("request_not_found")
        if info[0] != "Course Equivalency":
            raise db_error("not_course_equivalency")
        if info[1] != "In Progress":
            raise db_error("request_not_in_progress")
        if staff_id not in self.staff:
            raise db_error("staff_not_authorized")
        m = _PATH.fullmatch(storage_path)
        if not m or m.group(1) != request_id or m.group(2) != side:
            raise db_error("invalid_storage_path")
        if not re.fullmatch(r"[0-9a-f]{64}", sha256 or ""):
            raise db_error("invalid_sha256")
        obj = self.objects.get(storage_path)
        if obj is None:
            raise db_error("storage_object_not_found")
        if any(r["storage_path"] == storage_path for r in self.rows):
            raise db_error("already_registered")
        if obj["owner"] != self.staff[staff_id]:
            raise db_error("storage_object_owner_mismatch")
        if obj["size"] != size_bytes:
            raise db_error("storage_object_size_mismatch")
        if obj["mime"] != mime_type:
            raise db_error("storage_object_mime_mismatch")
        if sum(1 for r in self.rows if r["request_id"] == request_id and r["side"] == side) >= 20:
            raise db_error("too_many_versions")
        self._clock += timedelta(minutes=1)
        for r in self.rows:
            if r["request_id"] == request_id and r["side"] == side and r["is_current"]:
                r["is_current"], r["superseded_at"] = False, self._clock
                self._tx_superseded.append(r["syllabus_id"])
        sid = str(uuid.uuid4())
        self.rows.append({"syllabus_id": sid, "request_id": request_id, "side": side, "storage_path": storage_path,
                          "file_name": file_name, "mime_type": mime_type, "size_bytes": size_bytes, "sha256": sha256,
                          "source": "staff_upload", "uploaded_by_staff_id": staff_id, "uploaded_at": self._clock,
                          "registered_at": self._clock, "is_current": True, "superseded_at": None})
        return sid

    def superseded_in_this_transaction(self, conn, request_id, side):
        return list(self._tx_superseded)

    def syllabus_by_id(self, conn, syllabus_id):
        return next((dict(r) for r in self.rows if r["syllabus_id"] == syllabus_id), None)

    def syllabus_by_path(self, conn, storage_path):
        return next((dict(r) for r in self.rows if r["storage_path"] == storage_path), None)

    def is_ready(self, conn, request_id):
        return all(self.current(side, request_id) is not None for side in ("old", "new"))

    # ---- Storage stand-in (what the Storage service does for a staff upload)
    def store(self, bucket, path, data, content_type, access_token, owner=None):
        assert bucket == "course-syllabi"
        if path in self.objects:
            from app.core.storage import StorageConflictError
            raise StorageConflictError("An object already exists at that path.")
        self.objects[path] = {"owner": owner or STAFF.auth_user_id, "size": len(data), "mime": content_type,
                              "token": access_token}

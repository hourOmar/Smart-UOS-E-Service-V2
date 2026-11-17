"""Staff syllabus uploads for Course Equivalency requests (Phase 3B).

Upload sequence (POST), for one request and side:
  1. The file content is checked (syllabus_files): PDF or DOCX only, <= 10 MB.
     Nothing touches the database or Storage before this passes.
  2. One write transaction is opened and a TRANSACTION-scoped advisory lock on
     (request, side) is taken (pg_try_advisory_xact_lock, polled within a time
     budget). Uploads to the same request and side are therefore serialized;
     other requests and sides proceed independently. The lock is released by
     COMMIT or ROLLBACK -- also on any exception, timeout or dropped connection --
     so it can never outlive the transaction or leak through a connection pool.
  3. Under that lock, the authoritative pre-check: the request exists, is Course
     Equivalency and In Progress, the side has < 20 versions and, when the caller
     says which version it is replacing ("replaces"), that version is still
     current. Refusals here store nothing.
  4. Still under the lock, the file goes to Supabase Storage AS THE STAFF MEMBER
     (their access token, never service_role) at <Request_ID>/<side>/<uuid4>.<ext>;
     never overwrites.
  5. Still in the same transaction, app_private.register_course_syllabus registers
     it (Staff_ID only from the verified session) and the version it superseded is
     compared with "replaces" while the function's request-row lock is held; a
     mismatch rolls everything back (optimistic concurrency, atomic with
     registration). COMMIT releases both locks.

Lock order: advisory (request, side) -> request row (inside the function) ->
registry. Decisions take only the request row, never the advisory lock, so no
cycle exists. During step 4 the transaction is idle; the backend role's
idle_in_transaction_session_timeout (1 min) ends an abnormally slow upload's
session, which releases everything -- the uploaded object is then registered by
the retry below.

Failures never replace the current syllabus: the registry changes only on COMMIT.
A transient database failure after the upload is retried for the SAME object (no
second upload) in a new transaction that takes the lock again and first checks
whether the earlier attempt had in fact committed. A final failure leaves the
uploaded object unregistered, which the database never treats as current
(app_private.course_syllabi_reconciliation lists it). Messages returned to staff
never contain the token, paths of other objects or database details.
"""

import hashlib
import logging
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.exc import DBAPIError, InterfaceError, OperationalError

from app.core import storage
from app.core.auth import StaffSession
from app.core.database import DatabaseUnavailableError, read_only, write_transaction
from app.course_equivalency import syllabus_repository as repo
from app.course_equivalency.syllabus_files import (
    DOCX_MIME, MAX_FILE_BYTES, PDF_MIME, InvalidSyllabusFileError, check_syllabus_file, display_file_name,
)

log = logging.getLogger(__name__)

BUCKET = "course-syllabi"
REQUEST_TYPE = "Course Equivalency"
IN_PROGRESS = "In Progress"
SIDES = ("old", "new")
MAX_VERSIONS_PER_SIDE = 20
NO_CURRENT = "none"                 # "replaces" value: the caller expects no current version
REGISTRATION_ATTEMPTS = 3
RETRY_DELAYS_SECONDS = (0.5, 1.5)
LOCK_WAIT_SECONDS = 20.0            # how long an upload waits for another upload of the same side
LOCK_POLL_SECONDS = 0.25

REQUEST_ID_PATTERN = re.compile(r"^STUD_EQVO_ECTU_[0-9]{6}$")
_UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

_sleep = time.sleep                 # replaced in tests
_monotonic = time.monotonic         # replaced in tests


class SyllabusServiceError(Exception):
    """A refusal or failure to report to staff: HTTP status, stable code, safe message."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message

    def fresh(self) -> "SyllabusServiceError":
        """A new instance to raise (the module-level ones are templates shared by threads)."""
        return SyllabusServiceError(self.status, self.code, self.message)


NOT_FOUND = SyllabusServiceError(404, "request_not_found", "Request not found.")
NOT_COURSE_EQUIVALENCY = SyllabusServiceError(404, "not_course_equivalency", "This is not a Course Equivalency request.")
NOT_IN_PROGRESS = SyllabusServiceError(
    409, "request_not_in_progress", "Syllabi can only be uploaded while the request is In Progress.")
TOO_MANY_VERSIONS = SyllabusServiceError(
    409, "too_many_versions",
    f"This side already has the maximum of {MAX_VERSIONS_PER_SIDE} syllabus versions. Contact the system administrator.")
SYLLABUS_CHANGED = SyllabusServiceError(
    409, "syllabus_changed",
    "This syllabus was changed by another staff member. Reload the page to see the current version, then try again.")
UPLOAD_IN_PROGRESS = SyllabusServiceError(
    409, "upload_in_progress",
    "Another upload for this syllabus is still in progress. Wait a moment, reload the page and try again.")
UPLOAD_REFUSED = SyllabusServiceError(
    403, "upload_refused",
    "Storage refused the upload. This can happen when there have been too many recent incomplete uploads for this "
    "syllabus (wait up to 24 hours or contact the system administrator), when the request has just been closed, or "
    "when your session has expired (sign in again). Reload the page before trying again.")
DATABASE_UNAVAILABLE = SyllabusServiceError(
    503, "database_unavailable", "The database could not be reached. Nothing was uploaded. Try again shortly.")
UPLOAD_FAILED = SyllabusServiceError(
    503, "upload_failed", "The upload could not be completed. The current syllabus is unchanged. Try again.")
REGISTRATION_FAILED = SyllabusServiceError(
    502, "registration_failed",
    "The file was uploaded but could not be registered. The current syllabus is unchanged. Try again.")
REGISTRATION_UNAVAILABLE = SyllabusServiceError(
    503, "registration_unavailable",
    "The database could not be reached to register the file. The current syllabus is unchanged. Try again shortly.")

# Error messages raised by app_private.register_course_syllabus (Phase 3A) and what staff see.
_REGISTRATION_ERRORS = {
    "request_not_found": NOT_FOUND,
    "not_course_equivalency": NOT_COURSE_EQUIVALENCY,
    "request_not_in_progress": NOT_IN_PROGRESS,
    "too_many_versions": TOO_MANY_VERSIONS,
    "staff_not_authorized": SyllabusServiceError(403, "staff_not_authorized", "This page is for staff only."),
    "already_registered": SyllabusServiceError(409, "already_registered", "This file is already registered."),
}
# Raised when the backend's own checks and the uploaded object disagree: never expected.
_INTERNAL_REGISTRATION_ERRORS = frozenset({
    "invalid_side", "invalid_storage_path", "invalid_mime_type", "invalid_file_size", "file_too_large",
    "invalid_sha256", "invalid_file_name", "storage_object_not_found", "storage_object_owner_mismatch",
    "storage_object_size_mismatch", "storage_object_mime_mismatch",
})


@dataclass(frozen=True)
class _Registered:
    row: dict
    superseded_id: str | None
    ready: bool


class _StaleReplacement(Exception):
    """Raised inside the registration transaction to roll it back."""


# ----------------------------------------------------------------------------- helpers
def _public(row: dict) -> dict:
    """A registry row as JSON-ready data (Staff_ID only; no staff names)."""
    out = {}
    for key, value in row.items():
        out[key] = value.isoformat() if isinstance(value, datetime) else value
    if out.get("size_bytes") is not None:
        out["size_bytes"] = int(out["size_bytes"])
    return out


def _db_error_code(exc: BaseException) -> str | None:
    diag = getattr(getattr(exc, "orig", None), "diag", None)
    message = getattr(diag, "message_primary", None)
    return message if isinstance(message, str) else None


def _is_transient(exc: BaseException) -> bool:
    if isinstance(exc, (DatabaseUnavailableError, OperationalError, InterfaceError)):
        return True
    return isinstance(exc, DBAPIError) and bool(getattr(exc, "connection_invalidated", False))


def _check_request(conn, request_id: str) -> str:
    info = repo.request_info(conn, request_id)
    if info is None:
        raise NOT_FOUND.fresh()
    request_type, status = info
    if request_type != REQUEST_TYPE:
        raise NOT_COURSE_EQUIVALENCY.fresh()
    return status


def normalize_replaces(value: str | None) -> str | None:
    """None (not given), "none" or a lowercase UUID; anything else is refused."""
    if value is None:
        return None
    candidate = value.strip().lower()
    if candidate == NO_CURRENT or _UUID_PATTERN.fullmatch(candidate):
        return candidate
    raise SyllabusServiceError(422, "invalid_replaces", "'replaces' must be a syllabus ID or 'none'.")


# ----------------------------------------------------------------------------- read
def get_syllabi(request_id: str) -> dict:
    """Current version and full history per side, plus readiness. Read-only."""
    with read_only() as conn:
        status = _check_request(conn, request_id)
        rows = [_public(r) for r in repo.syllabus_rows(conn, request_id)]
        ready = repo.is_ready(conn, request_id)
    sides = {}
    for side in SIDES:
        versions = [r for r in rows if r["side"] == side]
        versions.reverse()                                   # newest first
        sides[side] = {"current": next((r for r in versions if r["is_current"]), None), "versions": versions}
    return {
        "request_id": request_id,
        "request_status": status,
        "can_upload": status == IN_PROGRESS,
        "ready": ready,
        "sides": sides,
        "limits": {"max_bytes": MAX_FILE_BYTES, "max_versions_per_side": MAX_VERSIONS_PER_SIDE,
                   "allowed_types": [PDF_MIME, DOCX_MIME]},
    }


# ----------------------------------------------------------------------------- upload steps (inside one transaction)
def _lock_side(conn, request_id: str, side: str) -> None:
    """Takes the (request, side) transaction lock, polling within LOCK_WAIT_SECONDS.
    Each poll is a short statement, so statement_timeout never applies to the wait."""
    deadline = _monotonic() + LOCK_WAIT_SECONDS
    while not repo.try_side_lock(conn, request_id, side):
        if _monotonic() >= deadline:
            raise UPLOAD_IN_PROGRESS.fresh()
        _sleep(LOCK_POLL_SECONDS)


def _check_under_lock(conn, request_id: str, side: str, replaces: str | None) -> None:
    if _check_request(conn, request_id) != IN_PROGRESS:
        raise NOT_IN_PROGRESS.fresh()
    versions, current_id = repo.side_summary(conn, request_id, side)
    if versions >= MAX_VERSIONS_PER_SIDE:
        raise TOO_MANY_VERSIONS.fresh()
    if replaces is not None and (current_id or NO_CURRENT) != replaces:
        raise SYLLABUS_CHANGED.fresh()


def _upload(request_id: str, side: str, extension: str, mime: str, data: bytes, token: str) -> str:
    """Stores the object as the staff member; returns its path. One retry with a new
    UUID on the (practically impossible) name collision."""
    for attempt in (1, 2):
        path = f"{request_id}/{side}/{uuid.uuid4()}.{extension}"
        try:
            storage.upload_object(BUCKET, path, data, mime, token)
            return path
        except storage.StorageConflictError:
            if attempt == 2:
                raise SyllabusServiceError(503, "storage_unavailable",
                                           "The file could not be stored. Try again.") from None
        except storage.StorageAccessDeniedError:
            raise UPLOAD_REFUSED.fresh() from None
        except storage.StorageRejectedError as exc:
            if exc.reason == "too_large":
                raise SyllabusServiceError(413, "file_too_large", "The file is larger than 10 MB.") from None
            if exc.reason == "type":
                raise SyllabusServiceError(415, "unsupported_type",
                                           "Only PDF and Word (.docx) files are accepted.") from None
            raise SyllabusServiceError(422, "upload_rejected", "Storage refused the file.") from None
        except storage.StorageNotConfiguredError:
            raise SyllabusServiceError(503, "storage_not_configured",
                                       "File storage is not configured on the server.") from None
        except storage.StorageUnavailableError:
            raise SyllabusServiceError(503, "storage_unavailable",
                                       "File storage could not be reached. Try again shortly.") from None
    raise AssertionError("unreachable")


def _register_in(conn, request_id: str, side: str, path: str, file_name: str, mime: str, size: int, sha256: str,
                 staff_id: int, replaces: str | None) -> _Registered:
    new_id = repo.register(conn, request_id=request_id, side=side, storage_path=path, file_name=file_name,
                           mime_type=mime, size_bytes=size, sha256=sha256, staff_id=staff_id)
    superseded = repo.superseded_in_this_transaction(conn, request_id, side)
    if len(superseded) > 1:
        raise RuntimeError("More than one version superseded in one registration.")
    previous = superseded[0] if superseded else None
    # The request lock taken by register_course_syllabus is still held: no other
    # registration can have run between that call and this comparison.
    if replaces is not None and (previous or NO_CURRENT) != replaces:
        raise _StaleReplacement()
    row = repo.syllabus_by_id(conn, new_id)
    return _Registered(row=row, superseded_id=previous, ready=repo.is_ready(conn, request_id))


def _already_committed(conn, path: str, request_id: str) -> _Registered | None:
    """After a failure that followed the upload: did an earlier attempt commit?"""
    row = repo.syllabus_by_path(conn, path)
    if row is None:
        return None
    rows = repo.syllabus_rows(conn, request_id)
    previous = next((r["syllabus_id"] for r in rows if r["side"] == row["side"] and not r["is_current"]
                     and r["superseded_at"] == row["registered_at"]), None)
    return _Registered(row=row, superseded_id=previous, ready=repo.is_ready(conn, request_id))


def _orphan(request_id: str, side: str, path: str, reason: str) -> None:
    log.warning("Course Equivalency syllabus stored but NOT registered (request %s, side %s, object %s): %s. "
                "The current syllabus is unchanged.", request_id, side, path.rsplit("/", 1)[-1], reason)


# ----------------------------------------------------------------------------- upload
def upload_syllabus(*, request_id: str, side: str, file_name: str | None, data: bytes, session: StaffSession,
                    replaces: str | None = None) -> dict:
    """Validates, then -- serialized per (request, side) -- checks, stores (as the
    staff member) and registers one syllabus version."""
    if not REQUEST_ID_PATTERN.fullmatch(request_id or "") or side not in SIDES:
        raise SyllabusServiceError(422, "invalid_target", "Unknown request or syllabus side.")
    replaces = normalize_replaces(replaces)
    try:
        checked = check_syllabus_file(file_name, data)
    except InvalidSyllabusFileError as exc:
        status = 413 if exc.code == "file_too_large" else 415 if exc.code in ("unsupported_type", "legacy_doc") else 422
        raise SyllabusServiceError(status, exc.code, exc.message) from None

    sha256 = hashlib.sha256(data).hexdigest()
    name = display_file_name(file_name, side, checked.extension)
    staff_id = session.identity.staff_id            # verified session only; never client input

    path: str | None = None                         # set once the object is stored; never uploaded twice
    result: _Registered | None = None
    last_failure = "unknown"
    for attempt in range(1, REGISTRATION_ATTEMPTS + 1):
        try:
            with write_transaction() as conn:       # COMMIT on success, ROLLBACK on any exception
                _lock_side(conn, request_id, side)
                if path is None:
                    _check_under_lock(conn, request_id, side, replaces)
                    path = _upload(request_id, side, checked.extension, checked.mime_type, data,
                                   session.access_token)
                else:
                    result = _already_committed(conn, path, request_id)
                if result is None:
                    result = _register_in(conn, request_id, side, path, name, checked.mime_type, checked.size_bytes,
                                          sha256, staff_id, replaces)
            break
        except _StaleReplacement:
            _orphan(request_id, side, path, "the syllabus was replaced by someone else meanwhile")
            raise SYLLABUS_CHANGED.fresh() from None
        except SyllabusServiceError as exc:
            if path is not None:
                _orphan(request_id, side, path, exc.code)
            raise
        except Exception as exc:                     # noqa: BLE001 -- classified below, never shown raw
            result = None
            if path is None:                         # nothing stored: nothing to retry for
                if _is_transient(exc):
                    raise DATABASE_UNAVAILABLE.fresh() from None
                log.error("Course Equivalency syllabus upload failed before storing (%s)", type(exc).__name__)
                raise UPLOAD_FAILED.fresh() from None
            code = _db_error_code(exc)
            if code in _REGISTRATION_ERRORS:
                _orphan(request_id, side, path, code)
                raise _REGISTRATION_ERRORS[code].fresh() from None
            if code in _INTERNAL_REGISTRATION_ERRORS:
                _orphan(request_id, side, path, code)
                log.error("Syllabus registration refused by the database (%s); backend checks and Storage disagree.",
                          code)
                raise REGISTRATION_FAILED.fresh() from None
            if not _is_transient(exc):
                _orphan(request_id, side, path, type(exc).__name__)
                raise REGISTRATION_FAILED.fresh() from None
            last_failure = type(exc).__name__
            if attempt < REGISTRATION_ATTEMPTS:
                _sleep(RETRY_DELAYS_SECONDS[attempt - 1])
    else:
        _orphan(request_id, side, path, f"database unavailable after {REGISTRATION_ATTEMPTS} attempts ({last_failure})")
        raise REGISTRATION_UNAVAILABLE.fresh()

    log.info("Course Equivalency syllabus registered (request %s, side %s, %d bytes, replaced %s)",
             request_id, side, checked.size_bytes, "yes" if result.superseded_id else "no")
    return {
        "request_id": request_id,
        "side": side,
        "syllabus": _public(result.row),
        "superseded_syllabus_id": result.superseded_id,
        "ready": result.ready,
    }

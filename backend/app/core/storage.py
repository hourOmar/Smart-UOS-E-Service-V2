"""Supabase Storage calls made AS THE SIGNED-IN STAFF MEMBER.

Each call sends the staff member's own Supabase access token
(Authorization: Bearer <token>) with the public anon key (apikey), so Storage
applies that user's policies: for incomplete-exam-proofs only staff
(app_private.is_staff) and the owning student may read; for course-syllabi only
staff may read and only staff may upload, to an exact path
(app_private.can_upload_course_syllabus). The backend holds no service_role key
and has no Storage grants of its own.

The token is used for one call only: it is never stored, logged or put in an
exception message. Downloads are streamed with a size cap and timeouts. Uploads
never overwrite (x-upsert: false); nothing here deletes.
"""

from urllib.parse import quote

import requests

from app.config import get_settings

_CHUNK = 64 * 1024


class StorageError(Exception):
    """Base class; messages never contain the token, the path or file contents."""


class StorageNotConfiguredError(StorageError):
    pass


class StorageObjectNotFoundError(StorageError):
    """The object does not exist, or the signed-in user may not see it (Storage
    reports both the same way)."""


class StorageAccessDeniedError(StorageError):
    """The session was rejected (expired or invalid token) or access was refused."""


class StorageObjectTooLargeError(StorageError):
    pass


class StorageUnavailableError(StorageError):
    """Storage could not be reached or answered unexpectedly."""


class StorageConflictError(StorageError):
    """An object already exists at that path (uploads never overwrite)."""


class StorageRejectedError(StorageError):
    """Storage refused the upload itself. `reason` is 'too_large', 'type' or 'rejected'."""

    def __init__(self, message: str, reason: str = "rejected") -> None:
        super().__init__(message)
        self.reason = reason


def object_url(supabase_url: str, bucket: str, path: str) -> str:
    """The authenticated-download endpoint; each path segment is URL-encoded."""
    return f"{supabase_url}/storage/v1/object/authenticated/{quote(bucket, safe='')}/{quote(path, safe='/')}"


def upload_url(supabase_url: str, bucket: str, path: str) -> str:
    """The upload endpoint; each path segment is URL-encoded."""
    return f"{supabase_url}/storage/v1/object/{quote(bucket, safe='')}/{quote(path, safe='/')}"


def _error_code(response) -> str:
    """The status Storage reports. Storage sometimes answers HTTP 400 with the real
    status in the JSON body ({"statusCode": "403", "error": ..., "message": ...})."""
    try:
        body = response.json()
    except ValueError:
        body = None
    if isinstance(body, dict):
        embedded = str(body.get("statusCode") or "").strip()
        if embedded.isdigit():
            return embedded
        error = str(body.get("error") or "").strip().lower().replace(" ", "_")
        if error in ("duplicate", "already_exists", "resourcealreadyexists"):
            return "409"
        if error in ("invalid_mime_type", "invalidmimetype"):
            return "415"
        if error in ("payload_too_large", "entitytoolarge", "entity_too_large"):
            return "413"
    return str(response.status_code)


def upload_object(bucket: str, path: str, data: bytes, content_type: str, access_token: str) -> None:
    """Uploads `data` to `bucket`/`path` with the staff member's session; never overwrites.

    Raises StorageConflictError (object exists), StorageAccessDeniedError (session or
    upload policy refused), StorageRejectedError (size / type / other refusal),
    StorageNotConfiguredError or StorageUnavailableError. A timeout is reported as
    unavailable: the object may or may not have been stored (it is then simply never
    registered)."""
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise StorageNotConfiguredError("Supabase Storage is not configured.")
    if not isinstance(access_token, str) or not access_token.strip():
        raise StorageAccessDeniedError("No staff session was provided for the upload.")
    timeout = settings.storage_timeout_seconds
    try:
        response = requests.post(
            upload_url(settings.supabase_url, bucket, path),
            data=data,
            headers={
                "apikey": settings.supabase_anon_key,
                "Authorization": f"Bearer {access_token.strip()}",
                "Content-Type": content_type,
                "x-upsert": "false",
                "cache-control": "no-cache",
            },
            timeout=(timeout, timeout),
            allow_redirects=False,
        )
    except requests.RequestException as exc:
        raise StorageUnavailableError(f"Supabase Storage could not be reached ({type(exc).__name__}).") from None

    try:
        if response.status_code == 200:
            return
        code = _error_code(response)
        if code == "409":
            raise StorageConflictError("An object already exists at that path.")
        if code in ("401", "403"):
            raise StorageAccessDeniedError(f"Supabase Storage refused the upload ({code}).")
        if code == "413":
            raise StorageRejectedError("Supabase Storage refused the file size.", "too_large")
        if code == "415":
            raise StorageRejectedError("Supabase Storage refused the file type.", "type")
        if code == "400":
            raise StorageRejectedError("Supabase Storage refused the upload (400).")
        raise StorageUnavailableError(f"Supabase Storage returned {code}.")
    finally:
        response.close()


def _is_not_found(response) -> bool:
    if response.status_code == 404:
        return True
    if response.status_code != 400:
        return False
    try:
        body = response.json()
    except ValueError:
        return False
    if not isinstance(body, dict):
        return False
    return str(body.get("statusCode")) == "404" or str(body.get("error", "")).lower() in ("not_found", "not found")


def download_object(bucket: str, path: str, access_token: str, *, max_bytes: int) -> bytes:
    """The object's bytes, read with the staff member's session.

    Raises StorageObjectNotFoundError, StorageAccessDeniedError,
    StorageObjectTooLargeError (more than `max_bytes`), StorageNotConfiguredError
    or StorageUnavailableError."""
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise StorageNotConfiguredError("Supabase Storage is not configured.")
    if not isinstance(access_token, str) or not access_token.strip():
        raise StorageAccessDeniedError("No staff session was provided for the download.")
    timeout = settings.storage_timeout_seconds
    try:
        response = requests.get(
            object_url(settings.supabase_url, bucket, path),
            headers={"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {access_token.strip()}"},
            timeout=(timeout, timeout),
            stream=True,
            allow_redirects=False,
        )
    except requests.RequestException as exc:
        raise StorageUnavailableError(f"Supabase Storage could not be reached ({type(exc).__name__}).") from None

    try:
        if _is_not_found(response):
            raise StorageObjectNotFoundError("The file was not found in Storage (or is not visible to this account).")
        if response.status_code in (401, 403):
            raise StorageAccessDeniedError(f"Supabase Storage refused the download ({response.status_code}).")
        if response.status_code != 200:
            raise StorageUnavailableError(f"Supabase Storage returned {response.status_code}.")

        declared = response.headers.get("Content-Length")
        if declared and declared.isdigit() and int(declared) > max_bytes:
            raise StorageObjectTooLargeError(f"The file is larger than {max_bytes} bytes.")

        data = bytearray()
        try:
            for chunk in response.iter_content(chunk_size=_CHUNK):
                data.extend(chunk)
                if len(data) > max_bytes:
                    raise StorageObjectTooLargeError(f"The file is larger than {max_bytes} bytes.")
        except requests.RequestException as exc:
            raise StorageUnavailableError(f"The download was interrupted ({type(exc).__name__}).") from None
        return bytes(data)
    finally:
        response.close()

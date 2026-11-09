"""Supabase Storage downloads made AS THE SIGNED-IN STAFF MEMBER.

Each download sends the staff member's own Supabase access token
(Authorization: Bearer <token>) with the public anon key (apikey), so Storage
applies that user's policies: for incomplete-exam-proofs only staff
(app_private.is_staff) and the owning student may read. The backend holds no
service_role key and has no Storage grants of its own.

The token is used for this one call only: it is never stored, logged or put in
an exception message. Downloads are streamed with a size cap and timeouts.
Read-only: nothing here uploads, overwrites or deletes.
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


def object_url(supabase_url: str, bucket: str, path: str) -> str:
    """The authenticated-download endpoint; each path segment is URL-encoded."""
    return f"{supabase_url}/storage/v1/object/authenticated/{quote(bucket, safe='')}/{quote(path, safe='/')}"


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

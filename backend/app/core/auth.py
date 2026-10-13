"""Staff authentication shared by every staff-only route.

1. The browser sends the signed-in user's Supabase access token
   (Authorization: Bearer <token>).
2. The token is verified by Supabase Auth itself (GET /auth/v1/user), so expired,
   forged or signed-out sessions are rejected whatever the signing method.
3. The verified user must be linked in Authorized_Staff (Auth_User_ID).

Only then may a route read request data or run an agent. Tokens are never logged
or stored.
"""

from dataclasses import dataclass

import requests
from fastapi import Header, HTTPException, status
from sqlalchemy import text

from app.config import get_settings
from app.core.database import DatabaseUnavailableError, read_only


@dataclass(frozen=True)
class StaffIdentity:
    auth_user_id: str
    staff_id: int


class SessionInvalidError(Exception):
    pass


class AuthServiceUnavailableError(Exception):
    pass


def verify_session(access_token: str) -> str:
    """Returns the Supabase user id for a valid session token."""
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise AuthServiceUnavailableError("Supabase Auth is not configured.")
    try:
        response = requests.get(
            f"{settings.supabase_url}/auth/v1/user",
            headers={"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {access_token}"},
            timeout=settings.auth_timeout_seconds,
        )
    except requests.RequestException as exc:
        raise AuthServiceUnavailableError("Supabase Auth could not be reached.") from exc

    if response.status_code in (400, 401, 403, 404):
        raise SessionInvalidError("The session is not valid.")
    if response.status_code != 200:
        raise AuthServiceUnavailableError(f"Supabase Auth returned {response.status_code}.")
    try:
        user_id = response.json().get("id")
    except ValueError as exc:
        raise AuthServiceUnavailableError("Supabase Auth returned an unreadable reply.") from exc
    if not isinstance(user_id, str) or not user_id:
        raise SessionInvalidError("The session has no user.")
    return user_id


def find_staff(auth_user_id: str) -> int | None:
    with read_only() as conn:
        row = conn.execute(
            text('SELECT "Staff_ID" FROM public."Authorized_Staff" WHERE "Auth_User_ID" = CAST(:uid AS uuid)'),
            {"uid": auth_user_id},
        ).first()
    return None if row is None else int(row[0])


def require_staff(authorization: str | None = Header(default=None)) -> StaffIdentity:
    """FastAPI dependency: 401 without a valid session, 403 for non-staff."""
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue.")
    try:
        user_id = verify_session(token.strip())
        staff_id = find_staff(user_id)
    except SessionInvalidError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has expired. Sign in again.") from exc
    except (AuthServiceUnavailableError, DatabaseUnavailableError) as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Sign-in could not be checked. Try again.") from exc
    if staff_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This page is for staff only.")
    return StaffIdentity(auth_user_id=user_id, staff_id=staff_id)

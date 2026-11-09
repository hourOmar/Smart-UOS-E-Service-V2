"""require_staff_session: the same checks as require_staff, plus the caller's
token for this request only (never in repr)."""

import pytest
from fastapi import HTTPException

from app.core import auth

TOKEN = "staff-access-token-SYNTHETIC-0123456789"
USER = "00000000-0000-0000-0000-0000000000b1"


@pytest.fixture
def staff(monkeypatch):
    seen = []

    def verify(token):
        seen.append(token)
        return USER

    monkeypatch.setattr(auth, "verify_session", verify)
    monkeypatch.setattr(auth, "find_staff", lambda uid: 100001 if uid == USER else None)
    return seen


def test_returns_identity_and_token(staff):
    session = auth.require_staff_session(f"Bearer {TOKEN}")
    assert session.identity == auth.StaffIdentity(auth_user_id=USER, staff_id=100001)
    assert session.access_token == TOKEN and staff == [TOKEN]
    assert TOKEN not in repr(session) and TOKEN not in str(session)


@pytest.mark.parametrize("header", [None, "", "Basic abc", "Bearer ", "Bearer    "])
def test_missing_or_malformed_header(staff, header):
    with pytest.raises(HTTPException) as raised:
        auth.require_staff_session(header)
    assert raised.value.status_code == 401 and staff == []


def test_non_staff_is_forbidden(monkeypatch):
    monkeypatch.setattr(auth, "verify_session", lambda token: USER)
    monkeypatch.setattr(auth, "find_staff", lambda uid: None)
    with pytest.raises(HTTPException) as raised:
        auth.require_staff_session(f"Bearer {TOKEN}")
    assert raised.value.status_code == 403


def test_require_staff_is_unchanged(staff):
    assert auth.require_staff(f"Bearer {TOKEN}") == auth.StaffIdentity(auth_user_id=USER, staff_id=100001)

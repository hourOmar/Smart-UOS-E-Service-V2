"""The one database module every agent and route uses.

Connects as the dedicated backend role (DATABASE_URL), never as postgres or
service_role. That role's grants and policies (database/maintenance/eligibility)
are the real access boundary; this module adds two habits on top:

- read_only(): a transaction Postgres itself refuses to write in. Use it for all
  evidence gathering.
- write_transaction(): an explicit, short read-write transaction. Use it only to
  record results.

All SQL is fixed text with bound parameters and quoted mixed-case identifiers.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import DBAPIError, OperationalError

from app.config import get_settings


class DatabaseUnavailableError(Exception):
    """The database could not be reached or is not configured."""


def _normalize_database_url(url: str) -> str:
    """Supabase hands out postgresql:// URLs, which would select psycopg2; this
    backend uses psycopg 3."""
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    url = get_settings().database_url
    if not url:
        raise DatabaseUnavailableError("DATABASE_URL is not configured.")
    return create_engine(
        _normalize_database_url(url),
        pool_pre_ping=True,
        # Error messages never include bound values (e.g. student IDs).
        hide_parameters=True,
        pool_size=5,
        max_overflow=5,
        # Supabase's transaction pooler cannot keep server-side prepared
        # statements across transactions; never prepare automatically.
        connect_args={"prepare_threshold": None},
    )


@contextmanager
def read_only() -> Iterator[Connection]:
    try:
        with get_engine().connect() as conn, conn.begin():
            conn.exec_driver_sql("SET TRANSACTION READ ONLY")
            yield conn
    except OperationalError as exc:
        raise DatabaseUnavailableError("The database could not be reached.") from exc


@contextmanager
def write_transaction() -> Iterator[Connection]:
    try:
        with get_engine().begin() as conn:
            yield conn
    except OperationalError as exc:
        raise DatabaseUnavailableError("The database could not be reached.") from exc


def is_unique_violation(exc: Exception) -> bool:
    return isinstance(exc, DBAPIError) and getattr(exc.orig, "sqlstate", None) == "23505"

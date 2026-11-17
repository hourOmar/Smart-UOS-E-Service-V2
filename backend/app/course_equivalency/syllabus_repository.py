"""Database access for Course Equivalency syllabi, as smart_uos_backend.

Fixed SQL with bound parameters only. The role may read public."Request"
(type and status), read public."Course_Equivalency_Syllabus" (RLS policy
course_equivalency_syllabus_backend_read) and execute exactly two functions:
app_private.register_course_syllabus and
app_private.course_equivalency_syllabi_ready (Phase 3A). It cannot write the
registry directly and has no Storage access.
"""

from sqlalchemy import text
from sqlalchemy.engine import Connection

_COLUMNS = """
    s."Syllabus_ID"::text AS syllabus_id, s."Request_ID" AS request_id, s."Side" AS side,
    s."Storage_Path" AS storage_path, s."File_Name" AS file_name, s."Mime_Type" AS mime_type,
    s."Size_Bytes" AS size_bytes, s."Sha256" AS sha256, s."Source" AS source,
    s."Uploaded_By_Staff_ID" AS uploaded_by_staff_id, s."Uploaded_At" AS uploaded_at,
    s."Registered_At" AS registered_at, s."Is_Current" AS is_current, s."Superseded_At" AS superseded_at
"""


LOCK_NAMESPACE = 1128616281      # "CESY": advisory-lock key space for syllabus uploads


def try_side_lock(conn: Connection, request_id: str, side: str) -> bool:
    """pg_try_advisory_xact_lock for one (request, side): never waits, and the lock
    belongs to the current TRANSACTION -- released automatically by COMMIT or
    ROLLBACK (also when the session ends), so it cannot leak past the
    transaction, whatever the connection pooling mode. Different requests or
    sides use different keys (a hash collision only adds serialization)."""
    return bool(conn.execute(
        text("SELECT pg_try_advisory_xact_lock(CAST(:ns AS integer), hashtext(:key))"),
        {"ns": LOCK_NAMESPACE, "key": f"{request_id}:{side}"},
    ).scalar_one())


def request_info(conn: Connection, request_id: str) -> tuple[str, str] | None:
    """(Request_Type, Current_Status), or None when the request does not exist."""
    row = conn.execute(
        text('SELECT "Request_Type", "Current_Status" FROM public."Request" WHERE "Request_ID" = :rid'),
        {"rid": request_id},
    ).first()
    return None if row is None else (row[0], row[1])


def syllabus_rows(conn: Connection, request_id: str) -> list[dict]:
    """Every registered version of the request, oldest first per side."""
    rows = conn.execute(
        text(f'SELECT {_COLUMNS} FROM public."Course_Equivalency_Syllabus" s WHERE s."Request_ID" = :rid '
             'ORDER BY s."Side", s."Uploaded_At", s."Registered_At", s."Syllabus_ID"'),
        {"rid": request_id},
    ).mappings().all()
    return [dict(r) for r in rows]


def side_summary(conn: Connection, request_id: str, side: str) -> tuple[int, str | None]:
    """(registered versions on this side, current Syllabus_ID or None)."""
    row = conn.execute(
        text('SELECT count(*), max(CASE WHEN "Is_Current" THEN "Syllabus_ID"::text END) '
             'FROM public."Course_Equivalency_Syllabus" WHERE "Request_ID" = :rid AND "Side" = :side'),
        {"rid": request_id, "side": side},
    ).one()
    return int(row[0]), row[1]


def register(conn: Connection, *, request_id: str, side: str, storage_path: str, file_name: str,
             mime_type: str, size_bytes: int, sha256: str, staff_id: int) -> str:
    """app_private.register_course_syllabus; locks the request row until this
    transaction ends. Returns the new Syllabus_ID."""
    return str(conn.execute(
        text("SELECT app_private.register_course_syllabus(CAST(:rid AS character varying), :side, :path, :name, "
             ":mime, CAST(:size AS bigint), :sha, CAST(:staff AS integer))"),
        {"rid": request_id, "side": side, "path": storage_path, "name": file_name, "mime": mime_type,
         "size": size_bytes, "sha": sha256, "staff": staff_id},
    ).scalar_one())


def superseded_in_this_transaction(conn: Connection, request_id: str, side: str) -> list[str]:
    """The versions of this side that THIS transaction superseded (the registration
    function's UPDATE; new row versions carry this transaction's id in xmin). Read
    while the function's request lock is still held, so no other registration can
    have intervened."""
    rows = conn.execute(
        text('SELECT "Syllabus_ID"::text FROM public."Course_Equivalency_Syllabus" '
             'WHERE "Request_ID" = :rid AND "Side" = :side AND NOT "Is_Current" '
             'AND xmin = CAST(pg_current_xact_id() AS xid)'),
        {"rid": request_id, "side": side},
    ).scalars().all()
    return [str(r) for r in rows]


def syllabus_by_id(conn: Connection, syllabus_id: str) -> dict | None:
    row = conn.execute(
        text(f'SELECT {_COLUMNS} FROM public."Course_Equivalency_Syllabus" s '
             'WHERE s."Syllabus_ID" = CAST(:sid AS uuid)'),
        {"sid": syllabus_id},
    ).mappings().first()
    return None if row is None else dict(row)


def syllabus_by_path(conn: Connection, storage_path: str) -> dict | None:
    row = conn.execute(
        text(f'SELECT {_COLUMNS} FROM public."Course_Equivalency_Syllabus" s WHERE s."Storage_Path" = :path'),
        {"path": storage_path},
    ).mappings().first()
    return None if row is None else dict(row)


def is_ready(conn: Connection, request_id: str) -> bool:
    """app_private.course_equivalency_syllabi_ready: read-only, starts nothing."""
    return bool(conn.execute(
        text("SELECT app_private.course_equivalency_syllabi_ready(CAST(:rid AS character varying))"),
        {"rid": request_id},
    ).scalar_one())

"""Storage for priority runs (agents.raise_capacity_priority_run) and the saved
priority fields (Raise_Capacity."Priority_Level" / "Priority_Result"); both
created or granted by database/maintenance/raise-capacity-priority/01_install.sql.

Run lifecycle (enforced by the table's constraints, the backend role's policies
and the save function):
    running -> completed   only through agents.save_raise_capacity_priority, in the
                           same transaction that saves into BOTH empty fields
    running -> discarded   the same function, when a value was already present
    running -> failed      error_message (technical failure or interrupted run)

Every read raises on failure; nothing here turns an unreadable value into a
missing one.
"""

import json
from datetime import timedelta

from sqlalchemy import bindparam, text
from sqlalchemy.engine import Connection

TABLE = "agents.raise_capacity_priority_run"

# A run still 'running' after this long is treated as interrupted (process stopped
# or crashed). Comfortably above the slowest normal run (page fetch + Gemini).
RUN_TIMEOUT = timedelta(minutes=10)

INTERRUPTED_MESSAGE = "Interrupted: the run did not finish (the backend stopped or timed out)."

_RUN_COLUMNS = (
    "id, request_id, run_status, run_trigger, triggered_by_staff_id, started_at, finished_at, "
    "priority, model, agent_version, error_message"
)


def lock_request(conn: Connection, request_id: str) -> None:
    """Transaction-scoped lock shared by every backend process, so only one of them
    can decide to start a run for this request at a time."""
    conn.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"raise_capacity_priority:{request_id}"},
    )


def expire_interrupted_runs(conn: Connection, request_id: str) -> int:
    result = conn.execute(
        text(
            f"UPDATE {TABLE} SET run_status = 'failed', finished_at = now(), error_message = :msg "
            "WHERE request_id = :rid AND run_status = 'running' "
            "AND started_at < now() - make_interval(secs => :secs)"
        ),
        {"rid": request_id, "secs": RUN_TIMEOUT.total_seconds(), "msg": INTERRUPTED_MESSAGE},
    )
    return result.rowcount


def read_requests(conn: Connection, request_ids: list[str]) -> dict[str, dict]:
    """Request type and status plus the saved priority fields, keyed by request ID.
    Missing IDs are absent from the result."""
    if not request_ids:
        return {}
    rows = conn.execute(
        text(
            'SELECT r."Request_ID" AS request_id, r."Request_Type" AS request_type, '
            'r."Current_Status" AS current_status, rc."Request_ID" IS NOT NULL AS has_raise_capacity, '
            'rc."Priority_Level" AS priority_level, rc."Priority_Result" AS priority_result '
            'FROM public."Request" r '
            'LEFT JOIN public."Raise_Capacity" rc ON rc."Request_ID" = r."Request_ID" '
            'WHERE r."Request_ID" IN :ids'
        ).bindparams(bindparam("ids", expanding=True)),
        {"ids": list(request_ids)},
    ).mappings().all()
    return {row["request_id"]: dict(row) for row in rows}


def list_runs(conn: Connection, request_ids: list[str]) -> dict[str, list[dict]]:
    """Runs per request, newest first, with `interrupted` marking a running row past
    the timeout. The stored evidence and result are not loaded here."""
    if not request_ids:
        return {}
    rows = conn.execute(
        text(
            f"SELECT {_RUN_COLUMNS}, (run_status = 'running' AND started_at < now() - make_interval(secs => :secs)) "
            f"AS interrupted FROM {TABLE} WHERE request_id IN :ids ORDER BY started_at DESC, id DESC"
        ).bindparams(bindparam("ids", expanding=True)),
        {"ids": list(request_ids), "secs": RUN_TIMEOUT.total_seconds()},
    ).mappings().all()
    runs: dict[str, list[dict]] = {}
    for row in rows:
        runs.setdefault(row["request_id"], []).append(dict(row))
    return runs


def start_run(conn: Connection, request_id: str, run_trigger: str, auth_user_id: str, staff_id: int,
              agent_version: str) -> int:
    return conn.execute(
        text(
            f"INSERT INTO {TABLE} (request_id, run_trigger, triggered_by, triggered_by_staff_id, agent_version) "
            "VALUES (:rid, :run_trigger, CAST(:uid AS uuid), :staff_id, :version) RETURNING id"
        ),
        {"rid": request_id, "run_trigger": run_trigger, "uid": auth_user_id, "staff_id": staff_id,
         "version": agent_version},
    ).scalar_one()


def save_result(conn: Connection, run_id: int, priority: str, result: dict, evidence: dict, model: str) -> str:
    """'saved' | 'discarded' | 'not_running'. Raises when the database refuses the
    result as invalid (nothing is changed then)."""
    return conn.execute(
        text(
            "SELECT agents.save_raise_capacity_priority(:run_id, :priority, CAST(:result AS jsonb), "
            "CAST(:evidence AS jsonb), :model)"
        ),
        {"run_id": run_id, "priority": priority, "result": json.dumps(result),
         "evidence": json.dumps(evidence, default=str), "model": model},
    ).scalar_one()


def fail_run(conn: Connection, run_id: int, error_message: str) -> bool:
    """False when the run is no longer 'running' (e.g. already expired as interrupted)."""
    updated = conn.execute(
        text(
            f"UPDATE {TABLE} SET run_status = 'failed', finished_at = now(), error_message = :msg "
            "WHERE id = :id AND run_status = 'running'"
        ),
        {"id": run_id, "msg": error_message[:2000]},
    )
    return updated.rowcount == 1

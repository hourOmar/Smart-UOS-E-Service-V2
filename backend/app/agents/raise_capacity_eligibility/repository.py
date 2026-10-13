"""Storage of evaluation runs in agents.raise_capacity_evaluation (one row per run,
full history; created by database/maintenance/eligibility/01_install.sql).

Run lifecycle (enforced by the table's constraints and the backend role's policies):
    running -> completed   (evidence, recommendation, explanations, model, version)
    running -> failed      (error_message; an interrupted run is failed on expiry)
Finished rows can never be changed again.
"""

import json
from datetime import timedelta

from sqlalchemy import text
from sqlalchemy.engine import Connection

TABLE = "agents.raise_capacity_evaluation"

# A run still 'running' after this long is treated as interrupted (process stopped
# or crashed). Comfortably above the slowest normal run (page fetch + Gemini).
RUN_TIMEOUT = timedelta(minutes=10)

_COLUMNS = (
    "id, request_id, run_status, run_trigger, triggered_by, triggered_by_staff_id, started_at, "
    "finished_at, recommendation, reasoning, check_explanations, evidence, gemini_status, "
    "gemini_error, model, agent_version, error_message"
)


def lock_request(conn: Connection, request_id: str) -> None:
    """Transaction-scoped lock shared by every backend process, so only one of them
    can decide to start a run for this request at a time."""
    conn.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"raise_capacity_eligibility:{request_id}"},
    )


def expire_interrupted_runs(conn: Connection, request_id: str) -> int:
    result = conn.execute(
        text(
            f"UPDATE {TABLE} SET run_status = 'failed', finished_at = now(), "
            "error_message = 'Interrupted: the run did not finish (the backend stopped or timed out).' "
            "WHERE request_id = :rid AND run_status = 'running' "
            "AND started_at < now() - make_interval(secs => :secs)"
        ),
        {"rid": request_id, "secs": RUN_TIMEOUT.total_seconds()},
    )
    return result.rowcount


def has_running_run(conn: Connection, request_id: str) -> bool:
    return conn.execute(
        text(f"SELECT 1 FROM {TABLE} WHERE request_id = :rid AND run_status = 'running' LIMIT 1"),
        {"rid": request_id},
    ).first() is not None


def has_any_run(conn: Connection, request_id: str) -> bool:
    return conn.execute(
        text(f"SELECT 1 FROM {TABLE} WHERE request_id = :rid LIMIT 1"), {"rid": request_id}
    ).first() is not None


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


def _json(value) -> str:
    return json.dumps(value, default=str)


def complete_run(conn: Connection, run_id: int, result: dict) -> bool:
    """False when the run is no longer 'running' (e.g. already expired as interrupted)."""
    updated = conn.execute(
        text(
            f"UPDATE {TABLE} SET run_status = 'completed', finished_at = now(), "
            "recommendation = :recommendation, reasoning = :reasoning, "
            "check_explanations = CAST(:checks AS jsonb), evidence = CAST(:evidence AS jsonb), "
            "gemini_status = :gemini_status, gemini_error = :gemini_error, model = :model "
            "WHERE id = :id AND run_status = 'running'"
        ),
        {
            "id": run_id,
            "recommendation": result["recommendation"],
            "reasoning": result["reasoning"],
            "checks": _json(result["checks"]),
            "evidence": _json(result["evidence"]),
            "gemini_status": result["gemini_status"],
            "gemini_error": result["gemini_error"],
            "model": result["model"],
        },
    )
    return updated.rowcount == 1


def fail_run(conn: Connection, run_id: int, error_message: str) -> bool:
    updated = conn.execute(
        text(
            f"UPDATE {TABLE} SET run_status = 'failed', finished_at = now(), error_message = :msg "
            "WHERE id = :id AND run_status = 'running'"
        ),
        {"id": run_id, "msg": error_message[:2000]},
    )
    return updated.rowcount == 1


def list_runs(conn: Connection, request_id: str) -> list[dict]:
    """Newest first, with `interrupted` marking a running row past the timeout."""
    rows = conn.execute(
        text(
            f"SELECT {_COLUMNS}, (run_status = 'running' AND started_at < now() - make_interval(secs => :secs)) "
            f"AS interrupted FROM {TABLE} WHERE request_id = :rid ORDER BY started_at DESC, id DESC"
        ),
        {"rid": request_id, "secs": RUN_TIMEOUT.total_seconds()},
    ).mappings().all()
    return [dict(row) for row in rows]

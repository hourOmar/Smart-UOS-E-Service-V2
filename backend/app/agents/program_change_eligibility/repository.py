"""Storage of evaluation runs in agents.program_change_evaluation (one row per
run, full history; created by
database/maintenance/program-change-eligibility/04_install_storage.sql).

Run lifecycle (enforced by the table's constraints and the backend role's policies):
    running -> completed   recommendation, report, deterministic results,
                           evidence, both model names
    running -> failed      failure_kind (data | technical | interrupted) and
                           error_message; never a recommendation or report
Finished rows can never be changed again.
"""

import json
from datetime import timedelta

from sqlalchemy import text
from sqlalchemy.engine import Connection

TABLE = "agents.program_change_evaluation"

# A run still 'running' after this long is treated as interrupted (process stopped
# or crashed). Comfortably above the slowest normal run (two Gemini calls, one
# reading a web page).
RUN_TIMEOUT = timedelta(minutes=10)

INTERRUPTED_MESSAGE = "Interrupted: the run did not finish (the backend stopped or timed out)."

MAX_ERROR_LENGTH = 2000

_COLUMNS = (
    "id, request_id, run_status, run_trigger, triggered_by, triggered_by_staff_id, started_at, "
    "finished_at, recommendation, report, deterministic_results, evidence, study_plan_model, "
    "assessment_model, agent_version, failure_kind, error_message"
)


def read_request(conn: Connection, request_id: str) -> dict | None:
    """The request's type and status (no student data), or None."""
    row = conn.execute(
        text('SELECT "Request_Type", "Current_Status" FROM public."Request" WHERE "Request_ID" = :rid'),
        {"rid": request_id},
    ).mappings().first()
    return None if row is None else {"request_type": row["Request_Type"], "current_status": row["Current_Status"]}


def lock_request(conn: Connection, request_id: str) -> None:
    """Transaction-scoped lock shared by every backend process, so only one of them
    can decide to start a run for this request at a time."""
    conn.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"program_change_eligibility:{request_id}"},
    )


def expire_interrupted_runs(conn: Connection, request_id: str) -> int:
    result = conn.execute(
        text(
            f"UPDATE {TABLE} SET run_status = 'failed', finished_at = now(), "
            "failure_kind = 'interrupted', error_message = :msg "
            "WHERE request_id = :rid AND run_status = 'running' "
            "AND started_at < now() - make_interval(secs => :secs)"
        ),
        {"rid": request_id, "secs": RUN_TIMEOUT.total_seconds(), "msg": INTERRUPTED_MESSAGE},
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


def complete_run(conn: Connection, run_id: int, outcome: dict) -> bool:
    """False when the run is no longer 'running' (e.g. already expired as interrupted).
    `outcome`: recommendation, report, deterministic_results, evidence,
    study_plan_model, assessment_model."""
    updated = conn.execute(
        text(
            f"UPDATE {TABLE} SET run_status = 'completed', finished_at = now(), "
            "recommendation = :recommendation, report = :report, "
            "deterministic_results = CAST(:deterministic_results AS jsonb), evidence = CAST(:evidence AS jsonb), "
            "study_plan_model = :study_plan_model, assessment_model = :assessment_model "
            "WHERE id = :id AND run_status = 'running'"
        ),
        {
            "id": run_id,
            "recommendation": outcome["recommendation"],
            "report": outcome["report"],
            "deterministic_results": _json(outcome["deterministic_results"]),
            "evidence": _json(outcome["evidence"]),
            "study_plan_model": outcome["study_plan_model"],
            "assessment_model": outcome["assessment_model"],
        },
    )
    return updated.rowcount == 1


def fail_run(conn: Connection, run_id: int, failure_kind: str, error_message: str) -> bool:
    """False when the run is no longer 'running'. Never stores a recommendation."""
    updated = conn.execute(
        text(
            f"UPDATE {TABLE} SET run_status = 'failed', finished_at = now(), "
            "failure_kind = :kind, error_message = :msg "
            "WHERE id = :id AND run_status = 'running'"
        ),
        {"id": run_id, "kind": failure_kind, "msg": error_message[:MAX_ERROR_LENGTH]},
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

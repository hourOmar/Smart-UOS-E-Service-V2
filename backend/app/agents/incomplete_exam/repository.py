"""Storage of evaluation runs in agents.incomplete_exam_evaluation (one row per
run, full history; created by
database/maintenance/incomplete-exam-eligibility/04_install_storage.sql).

Run lifecycle (enforced by the table's constraints and the backend role's policies):
    running -> completed   recommendation, reasoning, check explanations,
                           deterministic results, evidence, proof references,
                           assessment model, and -- exactly after a REJECT --
                           the rejection explanation (and its model)
    running -> failed      failure_kind (data | technical | interrupted) and
                           error_message; never a recommendation or outcome
Finished rows can never be changed again. Proof entries are references only
(path, outcome, type, size, SHA-256); file contents and access tokens are
never stored -- there is no column for either, and complete_run refuses proof
entries carrying anything else.
"""

import json
from datetime import timedelta

from sqlalchemy import text
from sqlalchemy.engine import Connection

from .request_data import has_incomplete_exam_details

TABLE = "agents.incomplete_exam_evaluation"

# A run still 'running' after this long is treated as interrupted (process stopped
# or crashed). Comfortably above the slowest normal run (proof downloads, Agent 5
# with documents, Agent 6 with retries).
RUN_TIMEOUT = timedelta(minutes=10)

INTERRUPTED_MESSAGE = "Interrupted: the run did not finish (the backend stopped or timed out)."

MAX_ERROR_LENGTH = 2000

LOCK_PREFIX = "incomplete_exam"

_COLUMNS = (
    "id, request_id, run_status, run_trigger, triggered_by, triggered_by_staff_id, started_at, "
    "finished_at, recommendation, reasoning, check_explanations, deterministic_results, evidence, "
    "proof_files, rejection_explanation, assessment_model, rejection_model, agent_version, "
    "failure_kind, error_message"
)

# Keys a stored proof reference may have (see proof_files.load_proof_files).
_PROOF_KEYS = frozenset({"path", "outcome", "mime_type", "bytes", "sha256"})


def read_request(conn: Connection, request_id: str) -> dict | None:
    """The request's type and status (no student data), or None."""
    row = conn.execute(
        text('SELECT "Request_Type", "Current_Status" FROM public."Request" WHERE "Request_ID" = :rid'),
        {"rid": request_id},
    ).mappings().first()
    return None if row is None else {"request_type": row["Request_Type"], "current_status": row["Current_Status"]}


def has_details(conn: Connection, request_id: str) -> bool:
    """False is the 'details missing' state: no Incomplete_Exam row."""
    return has_incomplete_exam_details(conn, request_id)


def lock_request(conn: Connection, request_id: str) -> None:
    """Transaction-scoped lock shared by every backend process, so only one of them
    can decide to start a run for this request at a time."""
    conn.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"{LOCK_PREFIX}:{request_id}"},
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


def _json(value) -> str | None:
    """JSON text for a jsonb parameter; None stays SQL NULL (not JSON null)."""
    return None if value is None else json.dumps(value, default=str)


def proof_references(proof_files: list[dict]) -> list[dict]:
    """The proof entries exactly as stored; refuses anything but references."""
    if not isinstance(proof_files, list):
        raise ValueError("proof_files must be a list of references.")
    for entry in proof_files:
        if not isinstance(entry, dict) or not set(entry) <= _PROOF_KEYS:
            raise ValueError("A proof entry may only hold path, outcome, mime_type, bytes and sha256.")
    return proof_files


def complete_run(conn: Connection, run_id: int, outcome: dict) -> bool:
    """False when the run is no longer 'running' (e.g. already expired as interrupted).
    `outcome`: recommendation, reasoning, check_explanations, deterministic_results,
    evidence, proof_files, rejection_explanation (None unless REJECT),
    assessment_model, rejection_model."""
    updated = conn.execute(
        text(
            f"UPDATE {TABLE} SET run_status = 'completed', finished_at = now(), "
            "recommendation = :recommendation, reasoning = :reasoning, "
            "check_explanations = CAST(:check_explanations AS jsonb), "
            "deterministic_results = CAST(:deterministic_results AS jsonb), "
            "evidence = CAST(:evidence AS jsonb), proof_files = CAST(:proof_files AS jsonb), "
            "rejection_explanation = CAST(:rejection_explanation AS jsonb), "
            "assessment_model = :assessment_model, rejection_model = :rejection_model "
            "WHERE id = :id AND run_status = 'running'"
        ),
        {
            "id": run_id,
            "recommendation": outcome["recommendation"],
            "reasoning": outcome["reasoning"],
            "check_explanations": _json(outcome["check_explanations"]),
            "deterministic_results": _json(outcome["deterministic_results"]),
            "evidence": _json(outcome["evidence"]),
            "proof_files": _json(proof_references(outcome["proof_files"])),
            "rejection_explanation": _json(outcome["rejection_explanation"]),
            "assessment_model": outcome["assessment_model"],
            "rejection_model": outcome["rejection_model"],
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

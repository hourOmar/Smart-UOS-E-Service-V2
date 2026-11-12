"""Runs the agent for one request (the standalone pipeline.run_pipeline) and
returns what the run history stores.

Order: check that Gemini is configured -> read the request (one read-only
transaction) -> five checks (check 3 asks Gemini) -> overall result ->
rejection step, only for NOT_ELIGIBLE. Nothing is recomputed or reworded
here, and nothing is written anywhere.
"""

import hashlib
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from pathlib import Path

from app.config import get_settings
from app.core.gemini import GeminiUnavailableError

from .llm_client import recording_calls
from .pipeline import run_pipeline

DATA_DIR = Path(__file__).resolve().parent / "data"
KNOWLEDGE_FILES = (
    "course_offerings_knowledge_base.txt",
    "bachelors_program_catalog.txt",
    "rejection_keywords.json",
)


@dataclass(frozen=True)
class CourseSubstitutionOutcome:
    result: dict = field(repr=False)          # {request_id, current_term, current_semester, overall_result, checks}
    rejection: dict | None = field(repr=False)  # explain_rejection_workflow result; NOT_ELIGIBLE only
    evidence: dict = field(repr=False)        # snapshot stored with the run
    study_plan_model: str | None = None
    rejection_model: str | None = None


def knowledge_file_fingerprints() -> list[dict]:
    return [
        {"file": f"data/{name}", "sha256": hashlib.sha256((DATA_DIR / name).read_bytes()).hexdigest()}
        for name in KNOWLEDGE_FILES
    ]


def json_ready(value):
    """Dates and times as ISO 8601 strings (Request_Date, Submission_Time), in
    nested dicts and lists; every other value unchanged."""
    if isinstance(value, dict):
        return {key: json_ready(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_ready(item) for item in value]
    if isinstance(value, (date, time)):   # datetime is a date
        return value.isoformat()
    return value


def evidence_snapshot(request: dict) -> dict:
    """The request dict (request_data reads no student email) with dates and
    times serialized, the knowledge files' fingerprints and the collection time."""
    return {
        "request": json_ready(request),
        "knowledge_files": knowledge_file_fingerprints(),
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }


def _model(calls: list[dict], use_url_context: bool) -> str | None:
    matching = [c["model"] for c in calls if c["use_url_context"] is use_url_context]
    return matching[-1] if matching else None


def evaluate_course_substitution_request(request_id: str) -> CourseSubstitutionOutcome:
    # Without a key every check 3 would silently become REQUIRES_REVIEW (and
    # every result MANUAL_REVIEW); fail the run as a technical failure instead.
    if not get_settings().gemini_api_key:
        raise GeminiUnavailableError("GEMINI_API_KEY is not configured.")

    with recording_calls() as calls:
        pipeline_result = run_pipeline(request_id)

    result = pipeline_result["eligibility_result"]
    not_eligible = result["overall_result"] == "NOT_ELIGIBLE"
    return CourseSubstitutionOutcome(
        result=result,
        rejection=pipeline_result["rejection_result"] if not_eligible else None,
        evidence=evidence_snapshot(pipeline_result["request"]),
        study_plan_model=_model(calls, use_url_context=True),
        rejection_model=_model(calls, use_url_context=False),
    )

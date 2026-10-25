"""Runs the Program Change agent for the run history.

evaluate_program_change_request() performs exactly the steps of Shaikha's
eligibility_agent.run_program_change_agent, in the same order and through the
same module-level names (so they are one and the same functions, prompts and
checks), and additionally returns what the run history stores:

- the evidence snapshot: the request as read, the current and requested
  program with the extracted study plan, the sources, and the name and
  SHA-256 fingerprint of each reference file (not their full text);
- the Gemini model that answered each of the two calls.

No academic logic lives here: nothing is computed, decided or reworded. Errors
raised by the agent propagate unchanged; service.py classifies them.
"""

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone

from . import eligibility_agent as agent
from .evidence import DATA_DIR
from .llm_client import recording_calls

REFERENCE_FILES = (
    "bachelors_program_catalog.txt",
    "program_change_constraints.txt",
    "university_courses.txt",
)


@dataclass(frozen=True)
class WorkflowOutcome:
    found: bool
    # Exactly what run_program_change_agent returns.
    result: dict
    evidence: dict | None = None
    study_plan_model: str | None = None
    assessment_model: str | None = None


def reference_file_fingerprints() -> list[dict]:
    return [
        {"file": f"data/{name}", "sha256": hashlib.sha256((DATA_DIR / name).read_bytes()).hexdigest()}
        for name in REFERENCE_FILES
    ]


def evidence_snapshot(evidence: dict) -> dict:
    """The evidence package without the full text of the reference files."""
    return {
        "request_id": evidence["request_id"],
        "request": evidence["request"],
        "current_program": evidence["current_program"],
        "requested_program": evidence["requested_program"],
        "sources": evidence["sources"],
        "reference_files": reference_file_fingerprints(),
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }


def _model(calls: list[dict], use_url_context: bool) -> str | None:
    matching = [c["model"] for c in calls if c["use_url_context"] is use_url_context]
    return matching[-1] if matching else None


def evaluate_program_change_request(request_id: str) -> WorkflowOutcome:
    with recording_calls() as calls:
        # --- the steps of run_program_change_agent, unchanged -----------------
        request_data = agent.get_program_change_request(request_id)

        if not request_data:
            return WorkflowOutcome(found=False, result={
                "request_id": request_id,
                "status": "NOT_FOUND",
                "message": (
                    "No Program Change request was found "
                    "for the provided request ID."
                ),
            })

        request = (
            request_data[0]
            if isinstance(request_data, list)
            else request_data
        )

        evidence = agent.build_evidence_package(request_id)

        requested_program_courses = (
            evidence["requested_program"]
            ["study_plan_source"]
            ["courses"]
        )

        deterministic_results = agent.run_basic_checks(
            request,
            requested_program_courses
        )

        prompt = agent.build_assessment_prompt(
            request,
            evidence,
            deterministic_results
        )

        response = agent.generate_with_fallback(prompt)

        report = response.text.strip()

        if not report:
            raise ValueError(
                "Gemini returned an empty academic assessment."
            )

        recommendation = agent.extract_recommendation(report)

        result = {
            "request_id": request_id,
            "report": report,
            "agent_recommendation": recommendation,
            "deterministic_results": deterministic_results,
        }
        # ------------------------------------------------------------------------

    return WorkflowOutcome(
        found=True,
        result=result,
        evidence=evidence_snapshot(evidence),
        study_plan_model=_model(calls, True),
        assessment_model=_model(calls, False),
    )

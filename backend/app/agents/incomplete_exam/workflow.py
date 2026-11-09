"""Runs Agent 5 and, only after a REJECT, Agent 6 for one request (the
standalone pipeline.run_pipeline), and returns what the run history stores.

Order: read the request (one read-only transaction) -> download the proof
documents as the signed-in staff member -> build the evidence -> Gemini
decision -> rejection explanation. Every request-level and data error is
raised before Gemini is called; nothing is computed or reworded here, and
nothing is written anywhere.

The Agent 5 and Agent 6 results have exactly the standalone shapes.
"""

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from . import eligibility_decision, evidence, proof_files, request_data
from .llm_calls import recording_calls
from .output_safeguard import OutputSafeguard
from .rejection_agent import explain_rejection_workflow

KNOWLEDGE_DIR = Path(__file__).resolve().parent / "knowledge_base"
KNOWLEDGE_FILES = ("incomplete_exam_policy.json", "rejection_keywords.json")


@dataclass(frozen=True)
class WorkflowOutcome:
    agent5: dict = field(repr=False)          # standalone evaluate_incomplete_exam_request_workflow result
    agent6: dict = field(repr=False)          # standalone explain_rejection_workflow result
    evidence: dict = field(repr=False)        # snapshot stored with the run (no file contents)
    proof_files: list[dict] = field(repr=False)
    assessment_model: str | None = None
    rejection_model: str | None = None


def knowledge_file_fingerprints() -> list[dict]:
    return [
        {"file": f"knowledge_base/{name}", "sha256": hashlib.sha256((KNOWLEDGE_DIR / name).read_bytes()).hexdigest()}
        for name in KNOWLEDGE_FILES
    ]


def evidence_snapshot(evidence_package: dict, output_safeguard: dict | None = None) -> dict:
    snapshot = {
        **evidence_package,
        "knowledge_files": knowledge_file_fingerprints(),
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }
    if output_safeguard is not None:
        snapshot["output_safeguard"] = output_safeguard   # counts only, never the original text
    return snapshot


def _model(calls: list[dict], agent: str) -> str | None:
    matching = [c["model"] for c in calls if c["agent"] == agent]
    return matching[-1] if matching else None


def run_incomplete_exam_agents(request_id: str, access_token: str) -> WorkflowOutcome:
    """`access_token`: the signed-in staff member's Supabase token, used only to
    download this request's proof documents; never stored."""
    data = request_data.get_incomplete_exam_request_data(request_id)
    proofs = proof_files.load_proof_files(request_id, data.proof_paths, access_token)
    evidence_package = evidence.build_evidence_package(request_id, data, proofs.files)

    safeguard = OutputSafeguard(data.student.get("Student_Name"), data.student.get("Student_ID"))
    with recording_calls() as calls:
        gemini_result = eligibility_decision.get_gemini_decision(evidence_package, attachments=proofs.files or None)
        agent5 = {
            "request_id": request_id,
            "evidence": evidence_package,
            "recommendation": gemini_result["recommendation"],
            "reasoning": gemini_result["reasoning"],
            "checks": gemini_result["checks"],
            "gemini_status": gemini_result["status"],
            "gemini_error": gemini_result["error"],
        }
        # Agent 5's generated text is cleaned BEFORE Agent 6 receives it (and
        # before storage); the recommendation and evidence are unchanged.
        agent5 = safeguard.clean_agent5(agent5)
        agent6 = explain_rejection_workflow(agent5)
        # Agent 6's student-facing suggestions are checked before storage.
        agent6 = safeguard.check_agent6(agent6)

    return WorkflowOutcome(
        agent5=agent5,
        agent6=agent6,
        evidence=evidence_snapshot(evidence_package, safeguard.report.as_dict()),
        proof_files=proofs.records,
        assessment_model=_model(calls, "eligibility"),
        rejection_model=_model(calls, "rejection"),
    )

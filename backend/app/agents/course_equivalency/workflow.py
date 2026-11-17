"""Runs the eligibility agent and the rejection explanation agent for one request (the
standalone pipeline.run_pipeline) and returns what the run history stores.

Order: read the request (one read-only transaction) -> download and verify the two current
syllabi as the signed-in staff member -> evidence -> Gemini syllabus analysis -> Gemini
decision + guardrails -> rejection explanation (only meaningful after REJECT). Every
request-level and data error is raised before Gemini is called; nothing is written here.
"""

import copy
import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from . import eligibility, output_safeguard, request_data, syllabus_files
from .llm_calls import recording_calls
from .policy import load_equivalency_policy
from .rejection import explain_rejection_workflow

KNOWLEDGE_DIR = Path(__file__).resolve().parent / "knowledge_base"
KNOWLEDGE_FILES = ("equivalency_policy.json", "grade_policy.json", "rejection_keywords.json")
RESULT_EXTRAS = ("equivalency_label", "major_similarities", "major_differences", "syllabus_request", "approval_note",
                 "gemini_status")


@dataclass(frozen=True)
class WorkflowOutcome:
    eligibility: dict = field(repr=False)        # standalone evaluate_course_equivalency_request result
    rejection: dict = field(repr=False)          # standalone explain_rejection_workflow result
    evidence: dict = field(repr=False)           # stored snapshot (no syllabus text or quotes)
    evaluated_syllabi: list[dict] = field(repr=False)
    assessment_model: str | None = None
    rejection_model: str | None = None


def knowledge_file_fingerprints() -> list[dict]:
    return [{"file": f"knowledge_base/{name}", "sha256": hashlib.sha256((KNOWLEDGE_DIR / name).read_bytes()).hexdigest()}
            for name in KNOWLEDGE_FILES]


def stored_similarity(similarity: dict | None) -> dict | None:
    """The similarity breakdown without verbatim syllabus quotes (topic labels, strengths and
    counts are kept)."""
    if similarity is None:
        return None
    sim = copy.deepcopy(similarity)
    ver = sim.get("match_verification") or {}
    for item in ver.get("verified_matches") or []:
        item.pop("quote_from_completed_syllabus", None)
    for item in ver.get("dropped_matches") or []:
        item.pop("quote_tried", None)
    return sim


def evidence_snapshot(result: dict, models: dict, safeguard: dict) -> dict:
    evidence = copy.deepcopy(result["evidence"])
    evidence["similarity"] = stored_similarity(evidence.get("similarity"))
    return {
        **evidence,
        "eligibility_result": {key: result.get(key) for key in RESULT_EXTRAS},
        "policy_status": load_equivalency_policy().get("status"),
        "models": models,
        "output_safeguard": safeguard,
        "knowledge_files": knowledge_file_fingerprints(),
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }


def _model(calls: list[dict], agent: str) -> str | None:
    matching = [c["model"] for c in calls if c["agent"] == agent]
    return matching[-1] if matching else None


def run_course_equivalency_agents(request_id: str, access_token: str) -> WorkflowOutcome:
    """`access_token`: the signed-in staff member's Supabase token, used only to download this
    request's two syllabi; never stored."""
    data = request_data.load_request_data(request_id)
    policy = load_equivalency_policy()
    load = syllabus_files.load_syllabi(request_id, data.syllabi, data.known_hashes, access_token,
                                       policy["max_syllabus_chars"])
    with recording_calls() as calls:
        result = eligibility.evaluate_course_equivalency_request(request_id, data, load.sides)
        result, cleaned = output_safeguard.clean_eligibility(result)
        rejection = explain_rejection_workflow(result)
        rejection, dropped = output_safeguard.check_rejection(rejection)
    models = {"syllabus_analysis": _model(calls, "syllabus_analysis"), "decision": _model(calls, "decision"),
              "rejection": _model(calls, "rejection")}
    return WorkflowOutcome(
        eligibility=result,
        rejection=rejection,
        evidence=evidence_snapshot(result, models, {"replaced_in_generated_text": cleaned,
                                                    "suggested_reasons_dropped": dropped}),
        evaluated_syllabi=load.references,
        assessment_model=models["decision"],
        rejection_model=models["rejection"],
    )

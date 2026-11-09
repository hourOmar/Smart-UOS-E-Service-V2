"""Keyword detection. Deterministic keywords come straight from Agent 5's verified
evidence (no AI involved); judgment keywords are only offered to Gemini as a closed list."""

import json
import os

_KB = os.path.join(os.path.dirname(__file__), "knowledge_base", "rejection_keywords.json")


def load_keyword_vocabulary() -> dict:
    with open(_KB, encoding="utf-8") as f:
        return json.load(f)["keywords"]


class _Safe(dict):
    def __missing__(self, key):
        return "(not recorded)"


def _facts(evidence: dict) -> dict:
    checks = evidence.get("checks", {})
    window = checks.get("submission_window") or {}
    exam = checks.get("exam_type") or {}
    return {
        "working_days_elapsed": window.get("working_days_elapsed"),
        "limit_working_days": window.get("limit_working_days"),
        "exam_type": exam.get("value"),
    }


def _no_proof_document(proof: dict) -> bool:
    """True only when no supporting document was attached.

    Proof means an attached document (Agent 5's own rule), so the typed proof
    description ("provided", from Incomplete_Exam.Proof, which the student may
    leave empty) never decides this on its own. Evidence recorded before
    file_attached existed keeps the original rule (provided is False)."""
    if proof.get("file_attached") is not None:
        return proof["file_attached"] is False
    return proof.get("provided") is False


def detect_deterministic_keywords(evidence: dict, vocabulary: dict) -> list[dict]:
    checks = evidence.get("checks", {})
    triggers = {
        "late_submission": (checks.get("submission_window") or {}).get("satisfied") is False,
        "no_proof_provided": _no_proof_document(checks.get("proof") or {}),
        "excluded_exam_type": (checks.get("exam_type") or {}).get("excluded") is True,
        "no_enrollment_record": (checks.get("enrollment") or {}).get("found") is False,
    }
    facts = _Safe(_facts(evidence))
    found = []
    for key, hit in triggers.items():
        if not hit or key not in vocabulary:
            continue
        entry = vocabulary[key]
        found.append({
            "keyword": key,
            "label": entry["label"],
            "policy_basis": entry["policy_basis"],
            "plain_reason": entry.get("plain_reason", "").format_map(facts),
        })
    return found


def judgment_keyword_options(vocabulary: dict) -> list[dict]:
    return [
        {"keyword": k, "label": v["label"], "policy_basis": v["policy_basis"]}
        for k, v in vocabulary.items() if v.get("detection") == "judgment"
    ]

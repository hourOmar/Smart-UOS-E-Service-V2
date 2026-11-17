"""The standalone's knowledge files, verifier, prompts, temperatures and policy values are
carried over unchanged (pinned by SHA-256 / exact values)."""

import hashlib
from pathlib import Path

from app.agents import course_equivalency
from app.agents.course_equivalency import gemini_calls, rejection_gemini, workflow
from app.agents.course_equivalency.policy import load_equivalency_policy, load_grade_policy

PACKAGE = Path(course_equivalency.__file__).parent
PINNED = {
    "knowledge_base/equivalency_policy.json": "514e93966cf96b9bb0326a45b5408b164639b52deb360fb35ac3ffe0078c431e",
    "knowledge_base/grade_policy.json": "a007c718d18de9d7c80b7b9da20d4fcf730709e55e4a313bb31c0636d6ff763f",
    "knowledge_base/rejection_keywords.json": "b71c38735427833d2aef51be1a3fca2a926923d1e4543af7b282be3a299ddf62",
    "match_verifier.py": "baf1af68a0b53d59c6194b5e49e95d0d2d12ba9801cd7e8b2267245aa025ea4a",
}
PROMPTS = {
    "analysis": "69ecf521be52e0b63ff2422a31c762ffadf77f8a0f7450d04c1d6c609fa95a8b",
    "decision": "4598574b601672c32380b08a9f9347444b94dc9982ad4418553bf5513aa381b4",
    "rejection": "12a112f437739fc60f185311e7a895e1abd9571a35e3531e169f58f5082d01c8",
}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def test_knowledge_files_and_verifier_are_byte_identical_to_the_standalone():
    for name, expected in PINNED.items():
        assert sha((PACKAGE / name).read_bytes()) == expected, name


def test_prompts_are_unchanged():
    assert sha(gemini_calls._ANALYSIS_RULES.encode()) == PROMPTS["analysis"]
    assert sha(gemini_calls._DECISION_RULES.encode()) == PROMPTS["decision"]
    assert sha(rejection_gemini._RULES.encode()) == PROMPTS["rejection"]


def test_temperatures_are_unchanged():
    assert gemini_calls.ANALYSIS_TEMPERATURE == 0.0 and gemini_calls.DECISION_TEMPERATURE == 0.0
    assert rejection_gemini.TEMPERATURE == 0.3


def test_policy_values_and_draft_status_are_preserved():
    p = load_equivalency_policy()
    assert p["similarity_thresholds"] == {"equivalent_min": 80, "review_min": 60}
    assert p["weights"] == {"topics": 0.5, "learning_outcomes": 0.25, "assessment_structure": 0.1, "credit_hours": 0.15}
    assert p["partial_match_weight"] == 0.5 and p["max_unverified_match_percent"] == 30
    assert p["status"] == "draft_thresholds"
    lim = p["constraints"]["transfer_credit_limits"]
    assert (lim["default_max_credit_hours"], lim["extended_max_credit_hours"], lim["max_fraction_of_study_plan"]) == (60, 70, 0.5)
    assert lim["extended_college_keywords"] == ["engineering", "health", "pharmacy"]
    g = load_grade_policy()
    assert g["equivalency_minimum_grade"] == "C+" and g["transfer_grade_code"] == "TR"


def test_knowledge_fingerprints_are_recorded_with_each_run():
    names = [f["file"] for f in workflow.knowledge_file_fingerprints()]
    assert names == ["knowledge_base/equivalency_policy.json", "knowledge_base/grade_policy.json",
                     "knowledge_base/rejection_keywords.json"]

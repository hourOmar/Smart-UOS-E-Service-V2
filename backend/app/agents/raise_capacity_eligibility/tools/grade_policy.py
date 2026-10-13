"""Prerequisite passing-grade policy (unchanged from the prototype).

Approved rule (UoS undergraduate grading policy, minimum passing grade = D):
    Passing:  A, B+, B, C+, C, D+, D
    Failing:  F, WF, FA
    NULL:     course still in progress / not completed -> does NOT satisfy a prerequisite
The mapping lives in knowledge_base/grade_policy.json.
"""

import json
import threading
from pathlib import Path

from ..exceptions import KnowledgeBaseError

_POLICY_PATH = Path(__file__).resolve().parent.parent / "knowledge_base" / "grade_policy.json"

_policy_cache: dict | None = None
_lock = threading.Lock()


def _load_policy() -> dict:
    global _policy_cache
    with _lock:
        if _policy_cache is not None:
            return _policy_cache
        if not _POLICY_PATH.exists():
            raise KnowledgeBaseError(f"Grade policy file not found at {_POLICY_PATH.name}.")
        try:
            data = json.loads(_POLICY_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise KnowledgeBaseError(f"Grade policy file is malformed JSON: {exc}") from exc
        if not isinstance(data.get("passing_grades"), list) or not isinstance(data.get("failing_grades"), list):
            raise KnowledgeBaseError("Grade policy file must define 'passing_grades' and 'failing_grades' lists.")
        data["_passing_set"] = {g.strip().upper() for g in data["passing_grades"]}
        data["_failing_set"] = {g.strip().upper() for g in data["failing_grades"]}
        _policy_cache = data
        return data


def classify_grade(grade: str | None) -> bool | None:
    """True = passing; False = not passing (failing grade, or NULL/in progress);
    None = a grade value the approved policy does not cover (unresolved, never guessed)."""
    policy = _load_policy()
    if grade is None:
        return False
    normalized = grade.strip().upper()
    if normalized in policy["_passing_set"]:
        return True
    if normalized in policy["_failing_set"]:
        return False
    return None

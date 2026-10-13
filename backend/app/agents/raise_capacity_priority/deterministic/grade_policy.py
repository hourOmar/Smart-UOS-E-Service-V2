"""
Loads the approved grade policy from
app/knowledge/raise_capacity/grade_policy.json and classifies a single
grade string against it. This is the only place passing/failing grade
lists exist — nothing else in the codebase should hardcode a grade.

A grade that is null, or that is not in either list, is UNRECOGNIZED/
MISSING rather than guessed as passing or failing — the caller (the
prerequisite evaluator) is responsible for treating that as unresolved
evidence.
"""

import json
from pathlib import Path
from typing import Literal, Optional

_POLICY_PATH = (
    Path(__file__).resolve().parents[1] / "knowledge" / "raise_capacity" / "grade_policy.json"
)

GradeStatus = Literal["PASSING", "FAILING", "UNRECOGNIZED", "MISSING"]


def _load_policy() -> dict:
    with open(_POLICY_PATH, encoding="utf-8") as f:
        return json.load(f)


_POLICY = _load_policy()
_PASSING_GRADES = set(_POLICY["passing_grades"])
_FAILING_GRADES = set(_POLICY["failing_grades"])


def classify_grade(grade: Optional[str]) -> GradeStatus:
    if grade is None:
        return "MISSING"
    if grade in _PASSING_GRADES:
        return "PASSING"
    if grade in _FAILING_GRADES:
        return "FAILING"
    return "UNRECOGNIZED"

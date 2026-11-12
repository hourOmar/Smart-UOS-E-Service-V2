
"""Detects rejection keywords from verified eligibility checks.

Unchanged from the standalone tools/rejection_keyword_tools.py (commit
32f83d3), except that the keyword file is the package's
data/rejection_keywords.json.
"""

import json
from pathlib import Path


KEYWORD_FILE = (
    Path(__file__).resolve().parent / "data" / "rejection_keywords.json"
)


def load_keyword_vocabulary() -> dict:
    """Load the rejection keyword vocabulary."""

    with open(KEYWORD_FILE, encoding="utf-8") as file:
        return json.load(file)["keywords"]


def detect_deterministic_keywords(
    checks: list,
    vocabulary: dict
) -> list:
    """Detect rejection keywords from failed eligibility checks."""

    keyword_mapping = {
        "Original course unavailable before graduation":
            "original_course_offered_before_graduation",

        "Proposed course is at the same level or higher":
            "proposed_course_lower_level",

        "Original course is a core course":
            "original_course_not_core",

        "Proposed course is offered in the current semester":
            "proposed_course_not_offered",

        "Proposed course has not been completed previously":
            "proposed_course_already_completed"
    }

    found = []

    for check in checks:

        if check.get("status") != "FAIL":
            continue

        condition = check.get("condition")
        keyword = keyword_mapping.get(condition)

        if not keyword or keyword not in vocabulary:
            continue

        entry = vocabulary[keyword]

        found.append({
            "keyword": keyword,
            "label": entry["label"],
            "policy_basis": entry["policy_basis"],
            "plain_reason": entry.get("plain_reason", "")
        })

    return found


def judgment_keyword_options(vocabulary: dict) -> list:
    """Return judgment-based keywords as a closed list for Gemini."""

    return [
        {
            "keyword": keyword,
            "label": entry["label"],
            "policy_basis": entry["policy_basis"]
        }
        for keyword, entry in vocabulary.items()
        if entry.get("detection") == "judgment"
    ]

"""
Loads the supplied prioritization policy unchanged, for Phase 6 to pass
to Gemini ALONGSIDE the evidence package — not embedded inside it. See
app/pipeline/build_prioritization_evidence.py's module docstring for the
reasoning.
"""

import json
from pathlib import Path

_POLICY_PATH = (
    Path(__file__).resolve().parents[1]
    / "knowledge"
    / "raise_capacity"
    / "prioritization_rules.json"
)


def load_prioritization_policy() -> dict:
    with open(_POLICY_PATH, encoding="utf-8") as f:
        return json.load(f)

"""Validates Agent 5's output for Agent 6. Agent 6 never touches the database:
Agent 5's finished result is its only input.

validate_agent5_result is unchanged from the standalone
tools/rejection_input_tools.py; its file and pasted-text parsing
(load_agent5_result, parse_agent5_text) served the command line only and is
not ported.
"""

from .exceptions import InvalidAgent5ResultError


def validate_agent5_result(result) -> dict:
    if not isinstance(result, dict):
        raise InvalidAgent5ResultError("The Agent 5 result must be a JSON object.")
    if "recommendation" not in result:
        raise InvalidAgent5ResultError("Missing 'recommendation' - this is not an Agent 5 result.")
    evidence = result.get("evidence")
    if not isinstance(evidence, dict) or not isinstance(evidence.get("checks"), dict):
        raise InvalidAgent5ResultError("Missing 'evidence.checks' - this is not an Agent 5 result.")
    if not isinstance(result.get("checks", {}), dict):
        raise InvalidAgent5ResultError("'checks' (Agent 5's per-check explanations) must be an object.")
    return result

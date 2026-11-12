"""Input handling for the Course Substitution Rejection Agent.

Unchanged from the standalone tools/rejection_input_tools.py (commit 32f83d3):
validate_eligibility_result. InvalidEligibilityResultError now lives in
exceptions.py. Not ported: parse_eligibility_text and load_eligibility_result
(command line only).
"""

from .exceptions import InvalidEligibilityResultError


def validate_eligibility_result(result) -> dict:
    """Validate the structure of the eligibility agent's output."""

    if not isinstance(result, dict):
        raise InvalidEligibilityResultError(
            "The eligibility result must be a JSON object."
        )

    if "overall_result" not in result:
        raise InvalidEligibilityResultError(
            "Missing 'overall_result'."
        )

    valid_results = {
        "ELIGIBLE",
        "NOT_ELIGIBLE",
        "MANUAL_REVIEW",
    }

    overall_result = result.get("overall_result")

    if overall_result not in valid_results:
        raise InvalidEligibilityResultError(
            f"Invalid overall result: {overall_result}"
        )

    checks = result.get("checks")

    if not isinstance(checks, list):
        raise InvalidEligibilityResultError(
            "Missing or invalid 'checks'."
        )

    for index, check in enumerate(checks, start=1):

        if not isinstance(check, dict):
            raise InvalidEligibilityResultError(
                f"Eligibility check {index} must be an object."
            )

        required_fields = ("condition", "status", "evidence")

        if not all(field in check for field in required_fields):
            raise InvalidEligibilityResultError(
                f"Eligibility check {index} is missing required fields."
            )

        if check["status"] not in {
            "PASS",
            "FAIL",
            "REQUIRES_REVIEW",
        }:
            raise InvalidEligibilityResultError(
                f"Eligibility check {index} has an invalid status."
            )

    return result

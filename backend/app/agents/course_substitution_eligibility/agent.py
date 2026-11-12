"""Course Substitution Eligibility Agent: evaluates one request.

Unchanged from the standalone agents/agent.py (commit 32f83d3):
evaluate_request (the five checks, check 3 replacing its placeholder) and
run_request. Not ported: main, display_request_information and display_check
(command line only). run_request no longer returns (None, None):
request_data raises a distinct error for every request that cannot be read.
"""

from .eligibility_checks import (
    evaluate_deterministic_checks,
    build_overall_result,
)

from .request_data import get_course_substitution_request

from .study_plan_check import check_original_course_is_core


def evaluate_request(
    request,
    current_date=None,
    knowledge_base_path=None,
):
    """Run eligibility checks and combine their results."""

    result = evaluate_deterministic_checks(
        request,
        current_date=current_date,
        knowledge_base_path=knowledge_base_path,
    )

    checks = result["checks"]
    core_check = check_original_course_is_core(request)

    for index, check in enumerate(checks):
        if check["condition"] == "Original course is a core course":
            checks[index] = core_check
            break
    else:
        checks.append(core_check)

    return build_overall_result(
        request,
        result.get("current_term"),
        checks,
    )


def run_request(request_id):
    """Retrieve and evaluate one Course Substitution request."""

    request = get_course_substitution_request(request_id)

    result = evaluate_request(request)

    return request, result

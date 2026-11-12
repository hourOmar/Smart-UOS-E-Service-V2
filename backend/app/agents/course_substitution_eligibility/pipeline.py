"""Runs the Course Substitution Eligibility and Rejection Agents.

Unchanged from the standalone pipeline.py (commit 32f83d3): run_pipeline and
its result shape. Not ported: main and display_pipeline_report (command line
only). The {"error": ...} result for an unknown request is gone: request_data
raises a distinct error instead.
"""

from .agent import run_request

from .rejection_agent import explain_rejection_workflow


def run_pipeline(request_id: str) -> dict:
    """Run both agents for one Course Substitution request."""

    request, eligibility_result = run_request(request_id)

    rejection_result = explain_rejection_workflow(eligibility_result)

    return {
        "request": request,
        "eligibility_result": eligibility_result,
        "rejection_result": rejection_result,
    }


"""Rejection Explanation Agent for Course Substitution.

Unchanged from the standalone agents/rejection_agent.py (commit 32f83d3);
only the imports are relative.
"""

from .rejection_input_tools import validate_eligibility_result

from .rejection_keyword_tools import (
    detect_deterministic_keywords,
    judgment_keyword_options,
    load_keyword_vocabulary,
)

from .rejection_gemini import get_rejection_suggestions

from .explanation_generator import prepare_rejection_explanations


def explain_rejection_workflow(eligibility_result: dict) -> dict:
    """Run the rejection explanation workflow."""

    # Validate the eligibility agent's output.
    validate_eligibility_result(eligibility_result)

    overall_result = eligibility_result["overall_result"]

    # Only generate rejection explanations for ineligible requests.
    if overall_result != "NOT_ELIGIBLE":
        return {
            "status": "not_applicable",
            "overall_result": overall_result,
            "message": (
                f"The eligibility agent returned {overall_result}. "
                "Rejection explanations are only generated for "
                "NOT_ELIGIBLE requests."
            ),
            "deterministic_keywords": [],
            "judgment_keywords": [],
            "suggested_reasons": [],
            "conflict_note": "",
        }

    # Load the rejection keyword knowledge base.
    vocabulary = load_keyword_vocabulary()

    checks = eligibility_result["checks"]

    # Detect confirmed rejection reasons using Python.
    deterministic = detect_deterministic_keywords(
        checks,
        vocabulary,
    )

    # Get the permitted judgment-based keywords.
    options = judgment_keyword_options(vocabulary)

    # Prepare the context sent to Gemini.
    context = {
        "overall_result": overall_result,
        "checks": checks,
        "deterministic_keywords": deterministic,
        "judgment_keyword_options": options,
    }

    # Generate explanations using Gemini.
    gemini_result = get_rejection_suggestions(context)

    # Validate Gemini's response or generate fallback explanations.
    explanations = prepare_rejection_explanations(
        gemini_result,
        deterministic,
        options,
    )

    return {
        "status": explanations.get("source", "Fallback").lower(),
        "overall_result": overall_result,
        "deterministic_keywords": deterministic,
        "judgment_keywords": explanations.get("judgment_keywords", []),
        "suggested_reasons": explanations.get("suggested_reasons", []),
        "conflict_note": explanations.get("conflict_note", ""),
        "fallback_note": explanations.get("fallback_note"),
        "gemini_error": gemini_result.get("error"),
    }

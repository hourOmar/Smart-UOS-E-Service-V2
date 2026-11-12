
"""Validates and prepares rejection explanations.

Gemini suggestions are checked against the verified rejection keywords.
If Gemini fails validation, deterministic fallback explanations are used.

Unchanged from the standalone tools/explanation_generator.py (commit 32f83d3);
only the import is relative.
"""

from .rejection_keyword_tools import load_keyword_vocabulary


REQUIRED_TONES = {"formal", "concise", "supportive"}


def create_fallback_explanations(deterministic_keywords: list) -> list:
    """Create explanations directly from verified rejection reasons."""

    if not deterministic_keywords:
        return []

    reasons = [
        item["plain_reason"]
        for item in deterministic_keywords
        if item.get("plain_reason")
    ]

    if not reasons:
        return []

    combined_reason = " ".join(reasons)

    return [
        {
            "tone": "formal",
            "text": (
                "Your Course Substitution request cannot be approved "
                f"for the following reason(s): {combined_reason}"
            ),
            "addresses_keywords": [
                item["keyword"] for item in deterministic_keywords
            ]
        },
        {
            "tone": "concise",
            "text": combined_reason,
            "addresses_keywords": [
                item["keyword"] for item in deterministic_keywords
            ]
        },
        {
            "tone": "supportive",
            "text": (
                "Unfortunately, your proposed course substitution "
                f"does not meet the eligibility requirements. {combined_reason}"
            ),
            "addresses_keywords": [
                item["keyword"] for item in deterministic_keywords
            ]
        }
    ]


def validate_gemini_suggestions(
    gemini_result: dict,
    deterministic_keywords: list,
    judgment_options: list
) -> dict:
    """Validate Gemini's output against the allowed keyword vocabulary."""

    vocabulary = load_keyword_vocabulary()

    allowed_deterministic = {
        item["keyword"] for item in deterministic_keywords
    }

    allowed_judgment = {
        item["keyword"] for item in judgment_options
    }

    selected_judgment = set(
        gemini_result.get("judgment_keywords", [])
    )

    if not selected_judgment.issubset(allowed_judgment):
        return {
            "valid": False,
            "error": "Gemini selected an unsupported judgment keyword."
        }

    allowed_keywords = allowed_deterministic | selected_judgment

    reasons = gemini_result.get("suggested_reasons", [])

    if len(reasons) != 3:
        return {
            "valid": False,
            "error": "Gemini must return exactly three explanations."
        }

    found_tones = set()
    covered_keywords = set()

    for reason in reasons:

        if not isinstance(reason, dict):
            return {
                "valid": False,
                "error": "An explanation has an invalid structure."
            }

        tone = reason.get("tone")
        text = reason.get("text")
        keywords = reason.get("addresses_keywords")

        if tone not in REQUIRED_TONES:
            return {
                "valid": False,
                "error": f"Invalid explanation tone: {tone}"
            }

        if tone in found_tones:
            return {
                "valid": False,
                "error": f"Duplicate explanation tone: {tone}"
            }

        if not isinstance(text, str) or not text.strip():
            return {
                "valid": False,
                "error": "An explanation has empty or invalid text."
            }

        if not isinstance(keywords, list):
            return {
                "valid": False,
                "error": "An explanation has invalid keyword references."
            }

        referenced_keywords = set(keywords)

        if not referenced_keywords.issubset(allowed_keywords):
            return {
                "valid": False,
                "error": "An explanation references an unsupported keyword."
            }

        found_tones.add(tone)
        covered_keywords.update(referenced_keywords)

    if found_tones != REQUIRED_TONES:
        return {
            "valid": False,
            "error": "The three required tones were not provided."
        }

    if not allowed_deterministic.issubset(covered_keywords):
        return {
            "valid": False,
            "error": "Not all verified rejection reasons were addressed."
        }

    for reason in reasons:
        reason["addresses_keywords"] = [
            keyword
            for keyword in reason["addresses_keywords"]
            if keyword in vocabulary
        ]

    return {
        "valid": True,
        "suggested_reasons": reasons,
        "judgment_keywords": list(selected_judgment),
        "conflict_note": gemini_result.get("conflict_note", "")
    }


def prepare_rejection_explanations(
    gemini_result: dict,
    deterministic_keywords: list,
    judgment_options: list
) -> dict:
    """Validate Gemini output or generate fallback explanations."""

    if gemini_result.get("status") == "ok":

        validation = validate_gemini_suggestions(
            gemini_result,
            deterministic_keywords,
            judgment_options
        )

        if validation["valid"]:
            return {
                "source": "Gemini",
                "suggested_reasons": validation["suggested_reasons"],
                "judgment_keywords": validation["judgment_keywords"],
                "conflict_note": validation["conflict_note"]
            }

    fallback = create_fallback_explanations(
        deterministic_keywords
    )

    return {
        "source": "Fallback",
        "suggested_reasons": fallback,
        "judgment_keywords": [],
        "conflict_note": "",
        "fallback_note": (
            "Gemini suggestions were unavailable or did not pass validation. "
            "These explanations were generated from verified rejection reasons."
        )
    }

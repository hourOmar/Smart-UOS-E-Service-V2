
"""Gemini wording step for the Course Substitution Rejection Agent.

Gemini receives verified eligibility evidence and a closed keyword list.
It suggests explanations but does not make eligibility decisions.

Uses the existing generate_with_fallback() function.

Unchanged from the standalone services/rejection_gemini.py (commit 32f83d3):
RULES, the prompt, the parsing and the result shape. Change: the error text
is sanitized (app.core.gemini.describe_failure).
"""

import json
import re

from app.core.gemini import describe_failure

from .llm_client import generate_with_fallback


RULES = """
You generate suggested rejection explanations for a Course Substitution
request that the eligibility agent has already determined is NOT_ELIGIBLE.

You do NOT make or change the eligibility decision.

Rules:
1. Use ONLY the information in the provided context.
   Never invent facts, course details, academic levels, or policies.

2. Select judgment_keywords only from the supplied
   judgment_keyword_options. Never create new keyword IDs.

3. Generate exactly THREE suggested_reasons:
   - One formal explanation.
   - One concise explanation.
   - One supportive explanation.

4. Each explanation must address at least one keyword ID in
   deterministic_keywords or the judgment keywords you selected.

5. Every deterministic keyword must be covered by the explanations.

6. Address the student in the second person.

7. Explain the actual failed eligibility conditions clearly and politely.

8. Do not claim that a condition failed if the evidence does not support it.

9. If the eligibility explanations contradict the verified evidence,
   describe the contradiction briefly in conflict_note.
   Otherwise, return an empty string.

10. Do not mention AI, Gemini, or an automated agent.

11. Do not promise appeals or procedures that are not included in the context.

12. Return ONLY valid JSON using this exact structure:

{
    "judgment_keywords": [],
    "suggested_reasons": [
        {
            "tone": "formal",
            "text": "Explanation...",
            "addresses_keywords": ["keyword_id"]
        },
        {
            "tone": "concise",
            "text": "Explanation...",
            "addresses_keywords": ["keyword_id"]
        },
        {
            "tone": "supportive",
            "text": "Explanation...",
            "addresses_keywords": ["keyword_id"]
        }
    ],
    "conflict_note": ""
}
"""


def extract_json(text: str) -> dict:
    """Extract and parse a JSON object from Gemini's response."""

    if not isinstance(text, str) or not text.strip():
        raise ValueError("Gemini returned an empty response.")

    cleaned = text.strip()

    cleaned = re.sub(
        r"^```(?:json)?\s*",
        "",
        cleaned,
        flags=re.IGNORECASE
    )

    cleaned = re.sub(r"\s*```$", "", cleaned)

    start = cleaned.find("{")

    if start == -1:
        raise ValueError("No JSON object found in Gemini's response.")

    result, _ = json.JSONDecoder().raw_decode(cleaned[start:])

    if not isinstance(result, dict):
        raise ValueError("Gemini's response must be a JSON object.")

    return result


def get_rejection_suggestions(context: dict) -> dict:
    """Generate three rejection explanations using the existing LLM client."""

    output = {
        "status": "ok",
        "error": None,
        "judgment_keywords": [],
        "suggested_reasons": [],
        "conflict_note": ""
    }

    try:
        prompt = (
            RULES
            + "\n\nCOURSE SUBSTITUTION ELIGIBILITY CONTEXT:\n"
            + json.dumps(context, indent=2, default=str)
        )

        response = generate_with_fallback(prompt)

        parsed = extract_json(response.text)

        judgment_keywords = parsed.get("judgment_keywords", [])
        suggested_reasons = parsed.get("suggested_reasons", [])
        conflict_note = parsed.get("conflict_note", "")

        if not isinstance(judgment_keywords, list):
            raise ValueError(
                "Gemini returned invalid judgment_keywords."
            )

        if not isinstance(suggested_reasons, list):
            raise ValueError(
                "Gemini returned invalid suggested_reasons."
            )

        if not isinstance(conflict_note, str):
            raise ValueError(
                "Gemini returned an invalid conflict_note."
            )

        output["judgment_keywords"] = judgment_keywords
        output["suggested_reasons"] = suggested_reasons
        output["conflict_note"] = conflict_note

    except Exception as exc:
        output.update(
            status="error",
            error=describe_failure(exc)
        )

    return output

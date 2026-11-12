"""Check 3: is the original course a core course? Gemini reads the program's
official study plan with URL context.

Unchanged from the standalone study_plan_check.py (commit 32f83d3): the
catalog lookup, the prompt, the reply parsing and normalization. Changes: the
call goes through llm_client (V2 settings, shared client), and the evidence
of a failed call is sanitized (app.core.gemini.describe_failure).
"""

import json
import re
from pathlib import Path

from app.core.gemini import describe_failure

from .llm_client import generate_with_fallback

CATALOG_PATH = (
    Path(__file__).resolve().parent
    / "data"
    / "bachelors_program_catalog.txt"
)

VALID_STATUSES = {"PASS", "FAIL", "REQUIRES_REVIEW"}


def _normalize(text):
    return " ".join(
        str(text or "").lower().replace("–", "-").split()
    )


def find_program_study_plan_url(student, catalog_path=None):
    """Find the official study-plan URL for the student's program."""
    path = Path(catalog_path) if catalog_path else CATALOG_PATH

    if not path.exists():
        return None, f"Program catalog file not found: {path}"

    text = path.read_text(encoding="utf-8-sig")
    blocks = re.split(r"\n\s*\n", text)

    program_id = str(student.get("program_id", "")).strip()
    program_name = _normalize(student.get("program_name", ""))

    candidates = []

    for block in blocks:
        id_match = re.search(
            r"Program ID:\s*(.+)", block, re.IGNORECASE
        )
        name_match = re.search(
            r"Program Name:\s*(.+)", block, re.IGNORECASE
        )
        url_match = re.search(
            r"Official URL:\s*(https?://\S+)",
            block,
            re.IGNORECASE,
        )

        if not (id_match and name_match and url_match):
            continue

        entry_id = id_match.group(1).strip()
        entry_name = name_match.group(1).strip()
        normalized_name = _normalize(entry_name)

        if entry_id != program_id:
            continue

        if (
            program_name
            and (
                program_name in normalized_name
                or normalized_name in program_name
            )
        ):
            score = 2
        elif program_name and all(
            word in normalized_name
            for word in program_name.split()
            if len(word) > 2
        ):
            score = 1
        else:
            score = 0

        candidates.append(
            (score, url_match.group(1).strip(), entry_name)
        )

    if not candidates:
        return (
            None,
            f"No catalog URL matched program ID {program_id!r} "
            f"and program name {student.get('program_name')!r}.",
        )

    candidates.sort(key=lambda item: item[0], reverse=True)

    best_score, url, matched_name = candidates[0]

    if best_score == 0:
        return (
            None,
            "Program ID matched, but the program name could not "
            f"be verified. Candidates: {[c[2] for c in candidates]}",
        )

    if (
        len(candidates) > 1
        and candidates[0][0] == candidates[1][0]
        and candidates[0][1] != candidates[1][1]
    ):
        return (
            None,
            "Multiple catalog entries match the program; "
            f"cannot safely select one: "
            f"{[c[2] for c in candidates if c[0] == best_score]}",
        )

    return url, f"Matched catalog program: {matched_name}"


def _extract_json(text):
    text = (text or "").strip()
    text = re.sub(
        r"^```(?:json)?\s*|\s*```$",
        "",
        text,
        flags=re.IGNORECASE,
    )

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)

        if not match:
            raise ValueError(
                "Gemini response did not contain a JSON object."
            )

        return json.loads(match.group(0))


def check_original_course_is_core(request):
    """
    Ask Gemini to inspect the official program study plan.

    PASS: official evidence confirms the original course is compulsory.
    FAIL: official evidence confirms the original course is an elective.
    REQUIRES_REVIEW: evidence is unavailable or ambiguous.
    """
    student = (
        request.get("student")
        if isinstance(request.get("student"), dict)
        else {}
    )
    original = (
        request.get("original_course")
        if isinstance(request.get("original_course"), dict)
        else {}
    )

    url, url_evidence = find_program_study_plan_url(student)

    if not url:
        return {
            "condition": "Original course is a core course",
            "status": "REQUIRES_REVIEW",
            "evidence": url_evidence,
            "source_url": None,
            "classification": "UNKNOWN",
        }

    prompt = f"""
You are verifying one academic eligibility condition for a
University of Sharjah course-substitution request.

TASK
Determine whether the ORIGINAL course is a compulsory/core
requirement in the student's specific degree study plan, rather
than an elective.

OFFICIAL STUDY-PLAN URL:
{url}

STUDENT PROGRAM: {student.get('program_name')}
PROGRAM ID: {student.get('program_id')}
ORIGINAL COURSE ID: {original.get('course_id')}
ORIGINAL COURSE NAME: {original.get('course_name')}

INSTRUCTIONS
1. Open and inspect the official URL using the available
   URL-context capability.
2. Locate the original course by course ID first, then name.
3. Determine whether the course is explicitly categorized as
   compulsory/core or elective in this degree plan.
4. Do not infer that a course is compulsory merely because it
   appears somewhere in the plan. Inspect the relevant section
   or category.
5. If the URL cannot be accessed, the course cannot be found,
   or the classification is ambiguous, return REQUIRES_REVIEW.
6. Do not use the local course-offerings knowledge base to
   classify the course.
7. Do not assess course equivalency or decide overall eligibility.
8. Do not claim to have opened the URL if you could not access it.
9. Provide brief supporting evidence from the official plan.

Return ONLY one valid JSON object:
{{
  "status": "PASS",
  "classification": "COMPULSORY",
  "evidence": "Brief explanation of the relevant plan section",
  "source_url": "{url}"
}}

Allowed status values:
PASS, FAIL, REQUIRES_REVIEW

Allowed classification values:
COMPULSORY, ELECTIVE, UNKNOWN

Status mapping:
- PASS only if the plan confirms the course is compulsory/core.
- FAIL only if the plan confirms the course is an elective.
- REQUIRES_REVIEW if the classification cannot be verified.
""".strip()

    try:
        response = generate_with_fallback(
            prompt,
            use_url_context=True,
        )

        data = _extract_json(response.text)

        status = str(
            data.get("status", "REQUIRES_REVIEW")
        ).upper().strip()

        classification = str(
            data.get("classification", "UNKNOWN")
        ).upper().strip()

        if status not in VALID_STATUSES:
            status = "REQUIRES_REVIEW"

        if classification not in {
            "COMPULSORY",
            "ELECTIVE",
            "UNKNOWN",
        }:
            classification = "UNKNOWN"

        # Do not accept inconsistent status/classification pairs.
        if status == "PASS" and classification != "COMPULSORY":
            status = "REQUIRES_REVIEW"

        if status == "FAIL" and classification != "ELECTIVE":
            status = "REQUIRES_REVIEW"

        evidence = str(
            data.get(
                "evidence",
                "Gemini did not provide supporting evidence.",
            )
        ).strip()

        source_url = str(data.get("source_url") or url).strip()

        return {
            "condition": "Original course is a core course",
            "status": status,
            "evidence": f"{url_evidence}. {evidence}",
            "source_url": source_url,
            "classification": classification,
        }

    except Exception as exc:
        return {
            "condition": "Original course is a core course",
            "status": "REQUIRES_REVIEW",
            "evidence": (
                "Could not verify the official study plan with Gemini: "
                f"{describe_failure(exc)}"
            ),
            "source_url": url,
            "classification": "UNKNOWN",
        }


from pathlib import Path
import re
import json

from .request_data import get_program_change_request
from .llm_client import generate_with_fallback


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"


def normalize_program_name(name):
    """
    Normalize program names for comparison without
    confusing different programs that share an ID.
    """
    name = re.sub(r"\s+", " ", str(name).strip())
    name = name.casefold()

    prefixes = (
        "bachelor of science in ",
        "bachelor of science ",
        "bachelor of arts in ",
        "bachelor of arts ",
        "bachelor in ",
    )

    for prefix in prefixes:
        if name.startswith(prefix):
            name = name[len(prefix):]
            break

    return name.strip()


def get_program_url(program_id, program_name):
    """
    Find the official UoS URL by matching BOTH
    the program ID and program name in the catalog.

    Raises an error if there is not exactly one match.
    """

    catalog_path = DATA_DIR / "bachelors_program_catalog.txt"

    catalog = catalog_path.read_text(encoding="utf-8")

    program_id = str(program_id).strip()
    target_name = normalize_program_name(program_name)

    blocks = re.split(
        r"(?=Program ID:\s*)",
        catalog
    )

    matches = []

    for block in blocks:

        id_match = re.search(
            r"Program ID:\s*(\d+)",
            block
        )

        name_match = re.search(
            r"Program Name:\s*(.*)",
            block
        )

        college_match = re.search(
            r"College:\s*(.*)",
            block
        )

        url_match = re.search(
            r"Official URL:\s*(\S+)",
            block
        )

        if not all((
            id_match,
            name_match,
            url_match,
        )):
            continue

        catalog_id = id_match.group(1)
        catalog_name = name_match.group(1).strip()

        if catalog_id != program_id:
            continue

        if normalize_program_name(catalog_name) != target_name:
            continue

        matches.append({
            "program_id": catalog_id,
            "program_name": catalog_name,
            "college": (
                college_match.group(1).strip()
                if college_match
                else ""
            ),
            "official_url": url_match.group(1).strip(),
        })

    if len(matches) != 1:
        raise ValueError(
            f"Expected exactly one catalog entry for "
            f"Program ID '{program_id}' and program name "
            f"'{program_name}', but found {len(matches)}. "
            f"Check data/bachelors_program_catalog.txt."
        )

    return matches[0]


def get_program_webpage(program_url, expected_program_name):
    """
    Ask Gemini to retrieve the official UoS webpage and
    extract its study-plan courses into structured data.

    Reject the result if the returned program name does
    not match the expected program.
    """

    prompt = f"""
Open and read this official University of Sharjah webpage:

{program_url}

The expected program is:
{expected_program_name}

Your task is ONLY to extract the study plan/curriculum
information from this webpage.

Return ONLY valid JSON using exactly this structure:

{{
    "program_name": "",
    "courses": [
        {{
            "course_id": "",
            "course_name": "",
            "credit_hours": 0
        }}
    ]
}}

IMPORTANT COURSE ID RULES:

1. Copy every Course_ID EXACTLY as it appears on the
   official webpage.

2. Course_ID is the identity of a course.

3. NEVER change, correct, normalize, add, remove, or
   reinterpret digits in a Course_ID.

4. NEVER assume that two courses are the same because
   their names are similar.

5. NEVER merge two different Course_IDs.

6. If two courses have different Course_IDs, keep them
   as separate courses even if their names are identical
   or very similar.

7. Do not use course names to create or infer Course_IDs.

8. Do not use general University of Sharjah knowledge.

9. Do not use information from other websites.

10. Only include courses that are actually present in
    the official webpage.

11. Preserve the credit hours shown on the webpage.

12. If the webpage contains an apparent inconsistency
    involving a Course_ID, preserve what the webpage
    actually shows. Do not silently correct it.

13. Verify that the webpage belongs to the expected
    program before extracting its courses.

Do not include explanations, markdown, or code fences.
Return JSON only.
"""

    response = generate_with_fallback(
        prompt,
        use_url_context=True
    )

    response_text = response.text

    if not response_text:
        raise ValueError(
            f"Gemini returned empty study-plan content "
            f"for {program_url}."
        )

    response_text = response_text.strip()

    if response_text.startswith("```"):
        response_text = re.sub(
            r"^```(?:json)?\s*",
            "",
            response_text,
            flags=re.IGNORECASE
        )

        response_text = re.sub(
            r"\s*```$",
            "",
            response_text
        )

    try:
        structured_plan = json.loads(response_text)

    except json.JSONDecodeError as error:
        raise ValueError(
            f"Gemini returned invalid JSON for {program_url}.\n"
            f"Response:\n{response_text}"
        ) from error

    if not isinstance(structured_plan, dict):
        raise ValueError(
            f"Invalid study-plan structure returned "
            f"for {program_url}."
        )

    returned_program_name = str(
        structured_plan.get("program_name", "")
    ).strip()

    if not returned_program_name:
        raise ValueError(
            "Gemini did not identify the program name "
            "on the official study-plan webpage."
        )

    if (
        normalize_program_name(returned_program_name)
        != normalize_program_name(expected_program_name)
    ):
        raise ValueError(
            f"Program mismatch: expected "
            f"'{expected_program_name}', but Gemini returned "
            f"'{returned_program_name}'. "
            "The study plan will not be used."
        )

    courses = structured_plan.get("courses")

    if not isinstance(courses, list):
        raise ValueError(
            f"Study-plan response does not contain a valid "
            f"'courses' list for {program_url}."
        )

    validated_courses = []

    for course in courses:

        if not isinstance(course, dict):
            continue

        course_id = str(
            course.get("course_id", "")
        ).strip()

        course_name = str(
            course.get("course_name", "")
        ).strip()

        credit_hours = course.get("credit_hours")

        if not course_id or not course_name:
            continue

        if credit_hours is None:
            continue

        try:
            credit_hours = int(credit_hours)

        except (TypeError, ValueError):
            continue

        validated_courses.append({
            "course_id": course_id,
            "course_name": course_name,
            "credit_hours": credit_hours,
        })

    if not validated_courses:
        raise ValueError(
            f"No valid courses were extracted from "
            f"the study plan at {program_url}."
        )

    return {
        "url": program_url,
        "program_name": returned_program_name,
        "courses": validated_courses,
    }


def build_evidence_package(request_id):
    """
    Gather the evidence needed for a Program Change
    eligibility assessment.

    This function does not determine eligibility.
    """

    # 1. Retrieve the Program Change request.
    request_data = get_program_change_request(
        request_id
    )

    if not request_data:
        raise ValueError(
            f"No Program Change request found for {request_id}."
        )

    request = (
        request_data[0]
        if isinstance(request_data, list)
        else request_data
    )

    # Supabase RPC may return the JSON object directly,
    # or the response may contain the function name as
    # its outer key.
    if (
        isinstance(request, dict)
        and "get_program_change_request" in request
    ):
        request = request["get_program_change_request"]

    if not isinstance(request, dict):
        raise ValueError(
            f"Unexpected request data returned for {request_id}."
        )

    if request.get("request_type") != "Program Change":
        raise ValueError(
            f"Request {request_id} is not a Program Change request."
        )

    # 2. Identify current and requested programs from
    #    the database request.
    current_program = request["current_program"]
    requested_program = request["new_program"]

    requested_program_id = requested_program["program_id"]
    requested_program_name = requested_program["program_name"]

    # 3. Resolve the official URL using BOTH program ID
    #    and program name.
    requested_program_source = get_program_url(
        requested_program_id,
        requested_program_name
    )

    # 4. Retrieve and validate the requested program's
    #    official study plan.
    requested_program_page = get_program_webpage(
        requested_program_source["official_url"],
        requested_program_source["program_name"]
    )

    # 5. Load Program Change rules.
    constraints = (
        DATA_DIR / "program_change_constraints.txt"
    ).read_text(encoding="utf-8")

    # 6. Load university-wide courses.
    university_courses = (
        DATA_DIR / "university_courses.txt"
    ).read_text(encoding="utf-8")

    # 7. Build the evidence package.
    evidence_package = {
        "request_id": request_id,

        "request": request,

        "current_program": current_program,

        "requested_program": {
            **requested_program_source,
            "study_plan_source": requested_program_page,
        },

        "transcript": request.get(
            "transcript",
            []
        ),

        "program_change_constraints": constraints,

        "university_courses": university_courses,

        "sources": [
            {
                "type": "program_catalog",
                "file": "data/bachelors_program_catalog.txt"
            },
            {
                "type": "program_change_rules",
                "file": "data/program_change_constraints.txt"
            },
            {
                "type": "university_courses",
                "file": "data/university_courses.txt"
            },
            {
                "type": "requested_program_webpage",
                "url": requested_program_source["official_url"]
            }
        ]
    }

    return evidence_package

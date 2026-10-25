
import re

from .request_data import get_program_change_request
from .evidence import build_evidence_package
from .eligibility_checks import run_basic_checks
from .llm_client import generate_with_fallback


ALLOWED_RECOMMENDATIONS = {
    "APPROVE",
    "REJECT",
    "REQUIRES_REVIEW",
}


RECOMMENDATION_ALIASES = {
    "REQUIRES REVIEW": "REQUIRES_REVIEW",
}

# "Recommendation:" label, optionally followed by its value on the same line.
RECOMMENDATION_LABEL = re.compile(
    r"^recommendation\s*:\s*(.*)$",
    re.IGNORECASE,
)

# "Recommendation" alone: a section heading.
RECOMMENDATION_HEADING = re.compile(
    r"^recommendation\s*$",
    re.IGNORECASE,
)


def clean_report_line(line):
    """
    Remove Markdown around a report line: emphasis and code marks,
    heading and quote marks, and a leading list bullet.
    """
    line = line.replace("*", "").replace("`", "")
    line = re.sub(r"^\s*[#>]+\s*", "", line)
    line = re.sub(r"^\s*[-•+]\s+", "", line)

    return line.strip()


def normalize_recommendation(value):
    """
    Return the recommendation a value states exactly, or None.

    Only the three allowed values are recognized (any letter case,
    surrounding underscores or a final full stop removed, and
    "REQUIRES REVIEW" for REQUIRES_REVIEW). Anything else, such as
    "APPROVE or REJECT" or a sentence, is not a recommendation.
    """
    value = value.strip().strip("_").strip()
    value = re.sub(r"\.+$", "", value).strip()
    value = re.sub(r"\s+", " ", value).upper()
    value = RECOMMENDATION_ALIASES.get(value, value)

    return value if value in ALLOWED_RECOMMENDATIONS else None


def extract_recommendation(report):
    """
    Extract the final recommendation from Gemini's report.

    Recommendations are read from a labeled line ("Recommendation:
    APPROVE") and from lines that state only a recommendation (the
    value under the "Recommendation:" heading, or a final line).
    Explanatory prose is never interpreted.

    Raises ValueError when there is no recommendation, when a labeled
    line holds an unsupported value, or when the report states
    different recommendations.
    """
    found = []

    for raw_line in report.splitlines():
        line = clean_report_line(raw_line)

        if not line or RECOMMENDATION_HEADING.match(line):
            continue

        label = RECOMMENDATION_LABEL.match(line)

        if label:
            value = label.group(1).strip()

            if not value:
                continue  # heading; its value follows on the next lines

            recommendation = normalize_recommendation(value)

            if recommendation is None:
                raise ValueError(
                    "Gemini report contains an unsupported "
                    "recommendation value."
                )

            found.append(recommendation)
            continue

        recommendation = normalize_recommendation(line)

        if recommendation is not None:
            found.append(recommendation)

    if not found:
        raise ValueError(
            "Gemini report does not contain a valid recommendation."
        )

    if len(set(found)) > 1:
        raise ValueError(
            "Gemini report contains contradictory recommendations: "
            + ", ".join(sorted(set(found)))
            + "."
        )

    return found[-1]


def format_matched_courses(matched_courses):
    """
    Format the deterministically verified applicable courses.
    """
    if not matched_courses:
        return "None"

    formatted_courses = []

    for course in matched_courses:
        formatted_courses.append(
            f'- {course["course_id"]} — '
            f'{course["course_name"]} — '
            f'{course["credit_hours"]} credits'
        )

    return "\n".join(formatted_courses)


def build_assessment_prompt(
    request,
    evidence,
    deterministic_results,
):
    """
    Build the prompt used by Gemini to produce
    the final academic assessment report.
    """
    current_program = evidence["current_program"]
    requested_program = evidence["requested_program"]

    formatted_courses = format_matched_courses(
        deterministic_results["matched_courses"]
    )

    return f"""
You are the Program Change Eligibility Academic Analyst
for the University of Sharjah.

Analyze ONLY the evidence provided below.

Produce a concise academic assessment summary.

You MUST use exactly these headings, in exactly this order:

ACADEMIC ASSESSMENT

Student:

Current Program:

Requested Program:

CGPA Assessment:

Credit Hour Assessment:

Applicable Courses:

Issues / Conflicts:

Overall Assessment:

Recommendation:

Do not add any other headings.
Do not create a Program Requirements Assessment section.
Do not remove or rename any required heading.

IMPORTANT FORMATTING RULES:

- Keep every section concise.
- Use short lines rather than long paragraphs.
- Do not combine multiple facts into one long sentence.
- Do not use semicolons.
- Do not use "True" or "False" when describing whether a requirement is satisfied.
- Use "Satisfied" or "Not Satisfied".
- Do not repeat the same information unnecessarily.

STUDENT:

Include only the Request ID.

CURRENT PROGRAM:

State the current program name and Program ID.

REQUESTED PROGRAM:

State the requested program name and Program ID.

CGPA ASSESSMENT:

Use exactly this format:

Verified CGPA: [value]
Requirement: 2.0 or above
Status: Satisfied

OR:

Verified CGPA: [value]
Requirement: 2.0 or above
Status: Not Satisfied

CREDIT HOUR ASSESSMENT:

Use exactly this format:

Completed Credit Hours: [value]
Applicable Credit Hours: [value]
Requirement: At least 15 applicable credit hours
Status: Satisfied

OR:

Completed Credit Hours: [value]
Applicable Credit Hours: [value]
Requirement: At least 15 applicable credit hours
Status: Not Satisfied

Do not use semicolons.

APPLICABLE COURSES:

List ONLY the courses contained in the VERIFIED APPLICABLE
COURSES section below.

Use exactly this format:

- Course_ID — Course Name — Credit Hours credits

Do not add courses.
Do not remove courses.
Do not change Course_IDs.
Do not change course names.
Do not change credit hours.

Course matching has already been performed deterministically
by Python using exact Course_ID comparison.

Course_ID is the identity of a course.

Different Course_IDs are different courses.

Never treat different Course_IDs as equivalent.

Never infer equivalence from similar course names.

ISSUES / CONFLICTS:

Identify only missing, ambiguous, or conflicting evidence.

Do not repeat the eligibility results here.

If there are no issues or conflicts, write exactly:

None

OVERALL ASSESSMENT:

Write ONE concise sentence explaining the overall academic
eligibility result.

Mention only the main reason for the outcome.

Do not repeat the complete applicable-course list.

Do not repeat detailed calculations.

Do not write a long paragraph.

RECOMMENDATION:

The recommendation MUST be exactly one of:

APPROVE
REJECT
REQUIRES_REVIEW

Do not provide multiple recommendations.

Do not write an explanation after the recommendation.

Use REQUIRES_REVIEW when required evidence is missing,
ambiguous, or conflicting.

The recommendation must be based only on the provided
evidence and Program Change rules.

------------------------------------------------------------
REQUEST
------------------------------------------------------------

Request ID:
{request["request_id"]}

Current Program:
{current_program["program_name"]}
Program ID: {current_program["program_id"]}

Requested Program:
{requested_program["program_name"]}
Program ID: {requested_program["program_id"]}

------------------------------------------------------------
TRANSCRIPT
------------------------------------------------------------

{request.get("transcript", [])}

------------------------------------------------------------
PROGRAM CHANGE RULES
------------------------------------------------------------

{evidence["program_change_constraints"]}

------------------------------------------------------------
UNIVERSITY MANDATORY COURSES
------------------------------------------------------------

{evidence["university_courses"]}

------------------------------------------------------------
REQUESTED PROGRAM STUDY PLAN
------------------------------------------------------------

{requested_program["study_plan_source"]["courses"]}

------------------------------------------------------------
VERIFIED DETERMINISTIC CHECKS
------------------------------------------------------------

CGPA:
{deterministic_results["cgpa"]}

CGPA Eligible:
{deterministic_results["cgpa_eligible"]}

Completed Credit Hours:
{deterministic_results["completed_hours"]}

Applicable Credit Hours:
{deterministic_results["applicable_hours"]}

------------------------------------------------------------
VERIFIED APPLICABLE COURSES
------------------------------------------------------------

{formatted_courses}

The applicable courses and applicable-credit-hour total
above were calculated by Python using exact Course_ID
matching.

The VERIFIED APPLICABLE COURSES list is authoritative.

Do not recalculate it.
Do not add courses.
Do not remove courses.
Do not modify Course_IDs.
Do not modify course names.
Do not modify credit hours.

------------------------------------------------------------
END OF EVIDENCE
------------------------------------------------------------

Now produce the academic assessment.

Follow the exact headings and formatting rules above.

Keep the assessment concise.
Use short lines.
Do not use semicolons.
Do not use True or False for requirement status.
Use Satisfied or Not Satisfied.

The final Recommendation must be exactly one of:

APPROVE
REJECT
REQUIRES_REVIEW
"""


def run_program_change_agent(request_id):
    """
    Run the complete Program Change Eligibility Agent.
    """

    request_data = get_program_change_request(request_id)

    if not request_data:
        return {
            "request_id": request_id,
            "status": "NOT_FOUND",
            "message": (
                "No Program Change request was found "
                "for the provided request ID."
            ),
        }

    request = (
        request_data[0]
        if isinstance(request_data, list)
        else request_data
    )

    evidence = build_evidence_package(request_id)

    requested_program_courses = (
        evidence["requested_program"]
        ["study_plan_source"]
        ["courses"]
    )

    deterministic_results = run_basic_checks(
        request,
        requested_program_courses
    )

    prompt = build_assessment_prompt(
        request,
        evidence,
        deterministic_results
    )

    response = generate_with_fallback(prompt)

    report = response.text.strip()

    if not report:
        raise ValueError(
            "Gemini returned an empty academic assessment."
        )

    recommendation = extract_recommendation(report)

    return {
        "request_id": request_id,
        "report": report,
        "agent_recommendation": recommendation,
        "deterministic_results": deterministic_results,
    }

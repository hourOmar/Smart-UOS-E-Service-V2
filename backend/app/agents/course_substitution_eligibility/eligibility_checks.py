"""Checks 1, 2, 4 and 5, the term rule and the overall result.

Unchanged from the standalone eligibility_checks.py (commit 32f83d3): every
rule, evidence text and result shape. The knowledge base is the package's
data/course_offerings_knowledge_base.txt (byte-identical, pinned by SHA-256
in the tests).
"""

from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo


# Check statuses
PASS = "PASS"
FAIL = "FAIL"
REQUIRES_REVIEW = "REQUIRES_REVIEW"

# Overall outcomes
ELIGIBLE = "ELIGIBLE"
NOT_ELIGIBLE = "NOT_ELIGIBLE"
MANUAL_REVIEW = "MANUAL_REVIEW"


# Course offerings knowledge base
KNOWLEDGE_BASE_PATH = (
    Path(__file__).resolve().parent
    / "data"
    / "course_offerings_knowledge_base.txt"
)


def make_check(condition, status, evidence):

    return {
        "condition": condition,
        "status": status,
        "evidence": evidence
    }


def parse_term(term):

    text = str(term or "").strip()

    if (
        len(text) != 6
        or not text.isdigit()
        or text[4:] not in {"01", "02"}
    ):
        return None

    return int(text[:4]), int(text[4:])


def term_order(term):

    parsed = parse_term(term)

    if parsed is None:
        return None

    year, semester_code = parsed

    return year * 2 + semester_code - 1


def term_to_semester(term):

    parsed = parse_term(term)

    if parsed is None:
        return None

    return "Fall" if parsed[1] == 1 else "Spring"


def next_term(term):

    parsed = parse_term(term)

    if parsed is None:
        return None

    year, semester_code = parsed

    if semester_code == 1:
        return year * 100 + 2

    return (year + 1) * 100 + 1


def get_current_term(today=None):

    """
    Academic term mapping:
    August-December = Fall
    January-May = Spring
    June-July = Unknown
    """

    if today is None:

        today = datetime.now(
            ZoneInfo("Asia/Dubai")
        ).date()

    elif isinstance(today, datetime):

        today = today.date()

    elif not isinstance(today, date):

        raise ValueError(
            "today must be a date or datetime object"
        )

    if 8 <= today.month <= 12:
        return today.year * 100 + 1

    if 1 <= today.month <= 5:
        return (today.year - 1) * 100 + 2

    return None


def valid_course_id(course_id):

    value = str(course_id or "").strip()

    return len(value) == 7 and value.isdigit()


# ---------------------------------------------------------
# KNOWLEDGE BASE
# ---------------------------------------------------------

def load_course_knowledge_base(file_path=None):

    """
    Read course offerings from the local knowledge-base file.

    Expected format:
    Course_ID | Course_Name | Fall | Spring | Summer
    """

    path = (
        Path(file_path)
        if file_path
        else KNOWLEDGE_BASE_PATH
    )

    if not path.exists():

        raise FileNotFoundError(
            f"Course offerings knowledge base not found: {path}"
        )

    courses = {}

    with path.open("r", encoding="utf-8-sig") as file:

        for raw_line in file:

            line = raw_line.strip()

            if not line or "|" not in line:
                continue

            parts = [
                part.strip()
                for part in line.strip("|").strip().split("|")
            ]

            if len(parts) != 5:
                continue

            course_id, course_name, fall, spring, summer = parts

            if not valid_course_id(course_id):
                continue

            def normalize(value):

                value = value.strip().lower()

                if value == "yes":
                    return "YES"

                if value == "no":
                    return "NO"

                return "UNKNOWN"

            courses[course_id] = {
                "course_id": course_id,
                "course_name": course_name,
                "offerings": {
                    "Fall": normalize(fall),
                    "Spring": normalize(spring),
                    "Summer": normalize(summer)
                }
            }

    return courses


# ---------------------------------------------------------
# CHECK 1: ORIGINAL COURSE UNAVAILABLE BEFORE GRADUATION
# ---------------------------------------------------------

def check_original_course_unavailable(
    original_course,
    student,
    courses,
    current_term
):

    name = "Original course unavailable before graduation"

    course_id = str(
        original_course.get("course_id", "")
    ).strip()

    if not valid_course_id(course_id):

        return make_check(
            name,
            REQUIRES_REVIEW,
            "The original course ID is missing or invalid."
        )

    course = courses.get(course_id)

    if course is None:

        return make_check(
            name,
            REQUIRES_REVIEW,
            f"Course {course_id} is missing from the offerings knowledge base."
        )

    graduation_term = student.get(
        "expected_graduation_term"
    )

    current_order = term_order(current_term)
    graduation_order = term_order(graduation_term)

    if current_order is None:

        return make_check(
            name,
            REQUIRES_REVIEW,
            "The current academic term could not be determined."
        )

    if graduation_order is None:

        return make_check(
            name,
            REQUIRES_REVIEW,
            "The expected graduation term is missing or invalid."
        )

    if graduation_order < current_order:

        return make_check(
            name,
            REQUIRES_REVIEW,
            "The expected graduation term is earlier than the current academic term."
        )

    checked = []

    term = current_term

    while term_order(term) <= graduation_order:

        semester = term_to_semester(term)

        offering = course["offerings"][semester]

        checked.append(
            f"{semester} ({term}): {offering}"
        )

        if offering == "YES":

            return make_check(
                name,
                FAIL,
                f"{course['course_name']} is offered in a remaining "
                f"{semester} semester. Checked: {', '.join(checked)}."
            )

        if offering == "UNKNOWN":

            return make_check(
                name,
                REQUIRES_REVIEW,
                f"The offering status for {course['course_name']} "
                f"is unknown in {semester}. Checked: {', '.join(checked)}."
            )

        # Check Summer between Spring and a later semester
        if (
            semester == "Spring"
            and term_order(term) < graduation_order
        ):

            summer = course["offerings"]["Summer"]

            checked.append(
                f"Summer after {term}: {summer}"
            )

            if summer == "YES":

                return make_check(
                    name,
                    FAIL,
                    f"{course['course_name']} is offered in "
                    "Summer before the expected graduation semester."
                )

            if summer == "UNKNOWN":

                return make_check(
                    name,
                    REQUIRES_REVIEW,
                    "The Summer offering status is unknown."
                )

        if term == graduation_term:
            break

        term = next_term(term)

        if term is None:

            return make_check(
                name,
                REQUIRES_REVIEW,
                "Could not determine the remaining academic terms."
            )

    return make_check(
        name,
        PASS,
        f"{course['course_name']} is not offered in any remaining "
        f"semester through graduation. Checked: {', '.join(checked)}."
    )


# ---------------------------------------------------------
# CHECK 2: PROPOSED COURSE IS AT THE SAME LEVEL OR HIGHER
# ---------------------------------------------------------

def check_course_level(original_course, proposed_course):

    name = "Proposed course is at the same level or higher"

    original_id = str(
        original_course.get("course_id", "")
    ).strip()

    proposed_id = str(
        proposed_course.get("course_id", "")
    ).strip()

    if (
        not valid_course_id(original_id)
        or not valid_course_id(proposed_id)
    ):

        return make_check(
            name,
            REQUIRES_REVIEW,
            "One or both course IDs are missing or invalid."
        )

    original_year = int(original_id[4])
    proposed_year = int(proposed_id[4])

    original_level = int(original_id[-2:])
    proposed_level = int(proposed_id[-2:])

    evidence = (
        f"Original year/level: {original_year}/{original_level}; "
        f"proposed year/level: {proposed_year}/{proposed_level}."
    )

    if (
        proposed_year > original_year
        or (
            proposed_year == original_year
            and proposed_level >= original_level
        )
    ):

        return make_check(
            name,
            PASS,
            evidence
        )

    return make_check(
        name,
        FAIL,
        evidence + " The proposed course is lower under the defined rule."
    )


# ---------------------------------------------------------
# CHECK 4: PROPOSED COURSE OFFERED IN CURRENT SEMESTER
# ---------------------------------------------------------

def check_proposed_course_offering(
    proposed_course,
    courses,
    current_term
):

    name = "Proposed course is offered in the current semester"

    course_id = str(
        proposed_course.get("course_id", "")
    ).strip()

    if not valid_course_id(course_id):

        return make_check(
            name,
            REQUIRES_REVIEW,
            "The proposed course ID is missing or invalid."
        )

    course = courses.get(course_id)

    if course is None:

        return make_check(
            name,
            REQUIRES_REVIEW,
            f"Course {course_id} is missing from the offerings knowledge base."
        )

    semester = term_to_semester(current_term)

    if semester is None:

        return make_check(
            name,
            REQUIRES_REVIEW,
            "The current Fall/Spring semester could not be determined."
        )

    offering = course["offerings"][semester]

    if offering == "YES":

        return make_check(
            name,
            PASS,
            f"{course['course_name']} is listed as offered in {semester}."
        )

    if offering == "NO":

        return make_check(
            name,
            FAIL,
            f"{course['course_name']} is listed as not offered in {semester}."
        )

    return make_check(
        name,
        REQUIRES_REVIEW,
        f"The knowledge base does not specify whether "
        f"{course['course_name']} is offered in {semester}."
    )


# ---------------------------------------------------------
# CHECK 5: PROPOSED COURSE NOT COMPLETED PREVIOUSLY
# ---------------------------------------------------------

def check_proposed_course_not_completed(
    proposed_course,
    course_completion
):

    name = "Proposed course has not been completed previously"

    proposed_id = str(
        proposed_course.get("course_id", "")
    ).strip()

    if not valid_course_id(proposed_id):

        return make_check(
            name,
            REQUIRES_REVIEW,
            "The proposed course ID is missing or invalid."
        )

    if (
        not isinstance(course_completion, dict)
        or "proposed_course_completed" not in course_completion
    ):

        return make_check(
            name,
            REQUIRES_REVIEW,
            "The student's course-completion information is unavailable."
        )

    completed = course_completion[
        "proposed_course_completed"
    ]

    if completed is True:

        return make_check(
            name,
            FAIL,
            f"Course {proposed_id} has previously been completed with a passing grade."
        )

    if completed is False:

        return make_check(
            name,
            PASS,
            f"Course {proposed_id} has not been completed with a passing grade."
        )

    return make_check(
        name,
        REQUIRES_REVIEW,
        "The student's course-completion status could not be determined."
    )


# ---------------------------------------------------------
# OVERALL RESULT
# ---------------------------------------------------------

def build_overall_result(request, current_term, checks):

    statuses = [
        check["status"]
        for check in checks
    ]

    # Any confirmed failure means NOT_ELIGIBLE
    if FAIL in statuses:

        overall = NOT_ELIGIBLE

    # All checks must pass for ELIGIBLE
    elif statuses and all(
        status == PASS for status in statuses
    ):

        overall = ELIGIBLE

    # Any unresolved check means MANUAL_REVIEW
    else:

        overall = MANUAL_REVIEW

    return {
        "request_id": request.get("request_id"),
        "current_term": current_term,
        "current_semester": term_to_semester(current_term),
        "overall_result": overall,
        "checks": checks
    }


# ---------------------------------------------------------
# RUN ALL DETERMINISTIC CHECKS
# ---------------------------------------------------------

def evaluate_deterministic_checks(
    request,
    current_date=None,
    knowledge_base_path=None
):

    if not isinstance(request, dict):

        raise ValueError(
            "Request must be a dictionary."
        )

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

    proposed = (
        request.get("proposed_course")
        if isinstance(request.get("proposed_course"), dict)
        else {}
    )

    course_completion = request.get(
        "course_completion"
    )

    current_term = get_current_term(current_date)

    try:

        courses = load_course_knowledge_base(
            knowledge_base_path
        )

    except (OSError, UnicodeError) as exc:

        error = (
            f"Could not load course offerings knowledge base: {exc}"
        )

        checks = [

            make_check(
                "Original course unavailable before graduation",
                REQUIRES_REVIEW,
                error
            ),

            check_course_level(
                original,
                proposed
            ),

            make_check(
                "Original course is a core course",
                REQUIRES_REVIEW,
                "Awaiting verification against the official program study plan."
            ),

            make_check(
                "Proposed course is offered in the current semester",
                REQUIRES_REVIEW,
                error
            ),

            check_proposed_course_not_completed(
                proposed,
                course_completion
            )
        ]

        return build_overall_result(
            request,
            current_term,
            checks
        )

    checks = [

        check_original_course_unavailable(
            original,
            student,
            courses,
            current_term
        ),

        check_course_level(
            original,
            proposed
        ),

        make_check(
            "Original course is a core course",
            REQUIRES_REVIEW,
            "Awaiting verification against the official program study plan."
        ),

        check_proposed_course_offering(
            proposed,
            courses,
            current_term
        ),

        check_proposed_course_not_completed(
            proposed,
            course_completion
        )
    ]

    return build_overall_result(
        request,
        current_term,
        checks
    )


# ---------------------------------------------------------
# REJECTION SUGGESTIONS
# ---------------------------------------------------------

def get_rejection_suggestion(checks):

    """
    Return one short suggestion based on the first failed check.
    """

    suggestions = {

        "Original course unavailable before graduation":
            "The original course is available before graduation. Consider registering for it instead of requesting a substitution.",

        "Proposed course is at the same level or higher":
            "Choose a replacement course at the same academic level or a higher level than the original course.",

        "Original course is a core course":
            "Course substitution is intended for core requirements. Review the study plan and select an eligible core course.",

        "Proposed course is offered in the current semester":
            "Choose a replacement course that is offered in the current semester.",

        "Proposed course has not been completed previously":
            "Choose a replacement course that you have not already completed with a passing grade."
    }

    for check in checks:

        if check["status"] == FAIL:

            return suggestions.get(
                check["condition"],
                "Review the failed eligibility condition and submit a request that meets the requirement."
            )

    return None
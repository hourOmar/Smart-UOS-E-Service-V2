from pathlib import Path
import re


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"


# Program Change academic requirements (both inclusive), as stated in
# data/program_change_constraints.txt.
MIN_CGPA = 2.0
MIN_APPLICABLE_HOURS = 15


GRADE_POINTS = {
    "A": 4.0,
    "B+": 3.5,
    "B": 3.0,
    "C+": 2.5,
    "C": 2.0,
    "D+": 1.5,
    "D": 1.0,
    "F": 0.0,
}


def is_completed_grade(grade):
    """Return True if the grade represents a completed course."""

    # No grade yet (course in progress): not completed.
    if grade is None or not str(grade).strip():
        return False

    grade = grade.strip().upper()

    if grade not in GRADE_POINTS:
        raise ValueError(
            f"Unknown grade: {grade}"
        )

    return grade != "F"


def calculate_completed_hours(transcript):
    """Calculate total completed credit hours."""

    total = 0

    for course in transcript:

        if is_completed_grade(course["grade"]):
            total += course["credit_hours"]

    return total


def load_university_courses():
    """
    Load university-wide courses from the knowledge base.
    """

    file_path = (
        DATA_DIR / "university_courses.txt"
    )

    content = file_path.read_text(
        encoding="utf-8"
    )

    courses = {}

    for line in content.splitlines():

        match = re.match(
            r"-\s*(\d{7})\s+—\s+(.+?)\s+—\s+(\d+)\s+credit hours",
            line
        )

        if match:

            course_id = match.group(1)
            course_name = match.group(2)
            credit_hours = int(match.group(3))

            courses[course_id] = {
                "course_id": course_id,
                "course_name": course_name,
                "credit_hours": credit_hours,
            }

    return courses


def get_course_ids(study_plan):
    """
    Get Course_IDs directly from the structured study plan.

    No regex or course-name matching is performed here.
    """

    course_ids = set()

    for course in study_plan:

        course_id = str(
            course["course_id"]
        ).strip()

        if course_id:
            course_ids.add(course_id)

    return course_ids


def calculate_program_applicable_hours(
    transcript,
    requested_program_study_plan
):
    """
    Calculate completed credit hours applicable to the
    requested program.

    A completed course counts when its EXACT Course_ID
    appears in the requested program study plan.

    University-wide courses are counted separately because
    they apply across university programs.

    Course names are NEVER used to establish equivalence.
    """

    requested_program_ids = get_course_ids(
        requested_program_study_plan
    )

    university_courses = load_university_courses()

    university_course_ids = set(
        university_courses.keys()
    )

    # Courses in the requested program study plan and
    # university-wide courses are considered applicable.
    applicable_course_ids = (
        requested_program_ids
        | university_course_ids
    )

    total = 0
    matched_courses = []
    matched_course_ids = set()

    for course in transcript:

        if not is_completed_grade(
            course["grade"]
        ):
            continue

        course_id = str(
            course["course_id"]
        ).strip()

        # Exact Course_ID comparison only.
        if (
            course_id in applicable_course_ids
            and course_id not in matched_course_ids
        ):

            total += course["credit_hours"]

            matched_courses.append({
                "course_id": course_id,
                "course_name": course["course_name"],
                "credit_hours": course["credit_hours"],
                "grade": course["grade"],
            })

            matched_course_ids.add(
                course_id
            )

    return total, matched_courses


def check_cgpa(cgpa):
    """Check the minimum CGPA requirement."""

    return cgpa >= MIN_CGPA


def check_applicable_hours(applicable_hours):
    """Check the minimum applicable credit-hour requirement."""

    return applicable_hours >= MIN_APPLICABLE_HOURS


def run_basic_checks(
    request,
    requested_program_study_plan
):
    """
    Run deterministic eligibility checks using
    the requested program study plan.
    """

    transcript = request.get(
        "transcript",
        []
    )

    cgpa = request.get(
        "student",
        {}
    ).get("cgpa")

    if cgpa is None:
        raise ValueError(
            "CGPA is missing."
        )

    completed_hours = calculate_completed_hours(
        transcript
    )

    applicable_hours, matched_courses = (
        calculate_program_applicable_hours(
            transcript,
            requested_program_study_plan
        )
    )

    return {
        "cgpa": cgpa,
        "cgpa_eligible": check_cgpa(cgpa),
        "completed_hours": completed_hours,
        "applicable_hours": applicable_hours,
        "matched_courses": matched_courses,
        "min_cgpa": MIN_CGPA,
        "min_applicable_hours": MIN_APPLICABLE_HOURS,
        "applicable_hours_eligible": check_applicable_hours(
            applicable_hours
        ),
    }
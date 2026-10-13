"""
Extracts raw rows out of the UoS CS degree page HTML. This module only
does HTML/BeautifulSoup work — turning a table row into a
PrerequisiteNode tree is app/retrieval/uos_prerequisite_parser.py's job.

Confirmed real structure (2026-09, verified by fetching the live page
before writing any selector here):

- Total credits: a "Total Credit Hours" <h4> followed by a sibling <h5>
  ("123 Cr. Hrs."), plus a summary <table> inside id="degree-overview"
  whose "Total" row's last cell repeats the same number — used as two
  independent anchors so a mismatch is detectable rather than silently
  trusted.
- id="degree-requirements" contains one flat richtext <div> where <h3>
  headings ("Mandatory Courses", "B. Mandatory Core Courses",
  "C. Elective Courses", "Study Plan") and <table> elements are flat
  siblings in document order — there is no per-section wrapper, so we
  track "current heading" while walking children in order.
- Each category table's first <tr> is the column header
  ("Course # | Course Title | Cr. Hr. | Prerequisite"). Each Study Plan
  table's first <tr> is instead a single label cell
  ("Year I, Semester 1 (16 Credits)") followed by its own header row —
  note the page inconsistently uses Roman numerals for Year 1 ("Year I")
  and Arabic numerals for Years 2-4 ("Year 2").
- Placeholder elective rows in the Study Plan use "-" as the course
  number (e.g. "University Elective - 1", "Dept. Specialized Elective -
  1") — course_id is None for these, never a real Course_ID.
- id="course-description" is unstructured prose: one <p> per course,
  course code + name + credit-hours + "Prerequisite:"/"Perquisite:"
  (the page misspells it once) all concatenated by <br/>. Treated as a
  best-effort third source, not a primary one.
"""

import re
from dataclasses import dataclass
from typing import Optional

from bs4 import BeautifulSoup

from ..retrieval.uos_errors import UoSPageStructureError
from ..schemas.uos import CourseCategory

_CATEGORY_HEADING_PATTERNS: list[tuple[re.Pattern, CourseCategory]] = [
    (re.compile(r"mandatory\s*core", re.IGNORECASE), "MANDATORY_CORE"),
    (re.compile(r"elective", re.IGNORECASE), "ELECTIVE"),
    (re.compile(r"mandatory", re.IGNORECASE), "MANDATORY"),
]
_STUDY_PLAN_HEADING_RE = re.compile(r"study\s*plan", re.IGNORECASE)
_YEAR_SEMESTER_RE = re.compile(r"Year\s+([IVX0-9]+),?\s*Semester\s+(\d+)", re.IGNORECASE)
_ROMAN_YEAR_MAP = {"I": 1, "II": 2, "III": 3, "IV": 4}
_COURSE_DESC_LEAD_RE = re.compile(r"^\s*(\d{7})\s*(.*)$")
_PREREQ_IN_TEXT_RE = re.compile(
    r"(?:Prerequisite|Perquisite|Pre-requisite)\s*:\s*(.*)$", re.IGNORECASE
)


@dataclass
class DegreeRequirementRow:
    course_id: Optional[int]
    course_name: str
    credit_hours: Optional[int]
    prerequisite_raw_text: str
    category: CourseCategory


@dataclass
class StudyPlanRow:
    course_id: Optional[int]
    course_name: str
    credit_hours: Optional[int]
    year: int
    semester: int
    prerequisite_raw_text: str
    is_placeholder_elective: bool


@dataclass
class CourseDescriptionRow:
    course_id: int
    course_name: str
    prerequisite_raw_text: str


def parse_total_credits_candidates(soup: BeautifulSoup) -> list[int]:
    values: list[int] = []

    for h4 in soup.find_all("h4"):
        if h4.get_text(strip=True) == "Total Credit Hours":
            h5 = h4.find_next_sibling("h5")
            if h5:
                match = re.search(r"\d+", h5.get_text())
                if match:
                    values.append(int(match.group(0)))

    overview = soup.find(id="degree-overview")
    if overview is not None:
        for table in overview.find_all("table"):
            for row in table.find_all("tr"):
                cells = row.find_all("td")
                if cells and cells[0].get_text(strip=True).lower() == "total" and len(cells) >= 2:
                    match = re.search(r"\d+", cells[-1].get_text(strip=True))
                    if match:
                        values.append(int(match.group(0)))

    return values


def parse_degree_requirements_and_study_plan(
    soup: BeautifulSoup,
) -> tuple[list[DegreeRequirementRow], list[StudyPlanRow]]:
    container = soup.find(id="degree-requirements")
    if container is None:
        raise UoSPageStructureError(
            "Could not find the Degree Requirements section (id='degree-requirements')."
        )

    degree_rows: list[DegreeRequirementRow] = []
    study_plan_rows: list[StudyPlanRow] = []
    current_heading: Optional[str] = None

    for element in container.find_all(["h3", "table"]):
        if element.name == "h3":
            current_heading = element.get_text(strip=True)
            continue

        if current_heading and _STUDY_PLAN_HEADING_RE.search(current_heading):
            study_plan_rows.extend(_parse_study_plan_table(element))
            continue

        category = _classify_heading(current_heading or "")
        if category is not None:
            degree_rows.extend(_parse_category_table(element, category))

    if not degree_rows:
        raise UoSPageStructureError(
            "Found the Degree Requirements section but no recognizable "
            "category tables (Mandatory/Mandatory Core/Elective) inside it."
        )
    if not study_plan_rows:
        raise UoSPageStructureError(
            "Found the Degree Requirements section but no recognizable "
            "Study Plan tables inside it."
        )

    return degree_rows, study_plan_rows


def parse_course_description_rows(soup: BeautifulSoup) -> list[CourseDescriptionRow]:
    container = soup.find(id="course-description")
    if container is None:
        raise UoSPageStructureError(
            "Could not find the Course Description section (id='course-description')."
        )

    rows: list[CourseDescriptionRow] = []
    for paragraph in container.find_all("p"):
        text = re.sub(r"\s+", " ", paragraph.get_text(separator=" ", strip=True))
        lead_match = _COURSE_DESC_LEAD_RE.match(text)
        if not lead_match:
            continue

        course_id = int(lead_match.group(1))
        rest = lead_match.group(2)
        prereq_match = _PREREQ_IN_TEXT_RE.search(rest)
        if not prereq_match:
            continue

        name_part = rest[: prereq_match.start()].strip()
        name_part = re.sub(r"\(\s*\d[^)]*\)\s*$", "", name_part).strip()

        rows.append(
            CourseDescriptionRow(
                course_id=course_id,
                course_name=name_part,
                prerequisite_raw_text=prereq_match.group(1).strip(),
            )
        )

    return rows


def _classify_heading(heading_text: str) -> Optional[CourseCategory]:
    for pattern, category in _CATEGORY_HEADING_PATTERNS:
        if pattern.search(heading_text):
            return category
    return None


def _parse_category_table(table, category: CourseCategory) -> list[DegreeRequirementRow]:
    rows = table.find_all("tr")
    result: list[DegreeRequirementRow] = []
    for tr in rows[1:]:
        cells = [cell.get_text(strip=True) for cell in tr.find_all("td")]
        if len(cells) < 4:
            continue
        course_id = _parse_int(cells[0])
        if course_id is None:
            continue
        result.append(
            DegreeRequirementRow(
                course_id=course_id,
                course_name=cells[1],
                credit_hours=_parse_int(cells[2]),
                prerequisite_raw_text=cells[3],
                category=category,
            )
        )
    return result


def _parse_study_plan_table(table) -> list[StudyPlanRow]:
    rows = table.find_all("tr")
    if len(rows) < 2:
        return []

    label_text = rows[0].get_text(strip=True)
    match = _YEAR_SEMESTER_RE.search(label_text)
    if not match:
        return []

    year = _parse_year_token(match.group(1))
    semester = _parse_int(match.group(2))
    if year is None or semester is None:
        return []

    result: list[StudyPlanRow] = []
    for tr in rows[2:]:
        cells = [cell.get_text(strip=True) for cell in tr.find_all("td")]
        if len(cells) < 4:
            continue
        course_id = _parse_int(cells[0])
        result.append(
            StudyPlanRow(
                course_id=course_id,
                course_name=cells[1],
                credit_hours=_parse_int(cells[2]),
                year=year,
                semester=semester,
                prerequisite_raw_text=cells[3],
                is_placeholder_elective=course_id is None,
            )
        )
    return result


def _parse_year_token(token: str) -> Optional[int]:
    token = token.strip().upper()
    if token in _ROMAN_YEAR_MAP:
        return _ROMAN_YEAR_MAP[token]
    if token.isdigit():
        return int(token)
    return None


def _parse_int(text: str) -> Optional[int]:
    text = text.strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        match = re.search(r"\d+", text)
        return int(match.group(0)) if match else None

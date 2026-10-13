"""Course-to-course prerequisites from the official University of Sharjah Computer
Science degree page (server-rendered HTML: tables inside #degree-requirements).

Rules unchanged from the prototype. Changes:
- The parsed page is cached for PREREQUISITE_CACHE_TTL_SECONDS, then fetched again
  (the prototype cached it for the life of the process). Failures are not cached.
- SOURCE LIMITATION, kept on purpose: this is the only prerequisite source. Courses
  that are not on the Computer Science degree page cannot be verified; they are
  reported as verified=False (MANUAL_REVIEW), never guessed. Every result carries
  `source_scope` so staff see the limitation.

Text conditions such as "Junior Standing" are kept in `additional_text_conditions`
and are NEVER converted into a credit-hour number.
"""

import re
import threading
import time

import requests
from bs4 import BeautifulSoup

from ..exceptions import PrerequisiteSourceUnavailableError
from .grade_policy import classify_grade

PREREQUISITE_SOURCE_URL = "https://www.sharjah.ac.ae/en/Academics/Degree/Undergraduate/Computer-Science"
PREREQUISITE_SOURCE_SCOPE = (
    "Only courses listed on the University of Sharjah Computer Science degree page can be "
    "verified; prerequisites of courses from other programs are not available to this agent."
)
PREREQUISITE_CACHE_TTL_SECONDS = 3600

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; SmartUoSEService-EligibilityAgent/1.0)"}
_REQUEST_TIMEOUT_SECONDS = 20
_COURSE_ID_PATTERN = re.compile(r"\b\d{6,8}\b")

_cache: dict | None = None
_cache_loaded_at = 0.0
_cache_lock = threading.Lock()


def _download_page_html() -> str:
    try:
        response = requests.get(PREREQUISITE_SOURCE_URL, headers=_HEADERS, timeout=_REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise PrerequisiteSourceUnavailableError(
            f"Could not reach the University of Sharjah degree page ({PREREQUISITE_SOURCE_URL}): "
            f"{type(exc).__name__}"
        ) from exc
    return response.text


def parse_degree_requirements(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    container = soup.find(id="degree-requirements")
    if container is None:
        raise PrerequisiteSourceUnavailableError(
            "The 'Degree Requirements' section (id='degree-requirements') was not found on the "
            "UoS page. The page layout may have changed."
        )

    courses: dict[int, dict] = {}
    conflicting_course_ids: set[int] = set()

    for table in container.find_all("table"):
        for row in table.find_all("tr"):
            cells = [cell.get_text(strip=True) for cell in row.find_all("td")]
            if len(cells) != 4:
                continue
            course_id_text, course_title, _credit_hours, prerequisite_text = cells
            if course_id_text.strip().lower() == "course #":
                continue  # header row
            if not course_id_text.strip().isdigit():
                continue  # not a course data row

            course_id = int(course_id_text.strip())
            raw_text = prerequisite_text.strip()
            parsed = parse_prerequisite_text(raw_text)
            # Compare by parsed meaning, not raw text: the page lists some courses twice
            # with different wording order. Only a genuine difference is a conflict.
            normalized = (
                parsed["relationship_type"],
                tuple(sorted(tuple(sorted(group)) for group in parsed["prerequisite_groups"])),
                tuple(sorted(cond.lower() for cond in parsed["additional_text_conditions"])),
                parsed["is_pre_or_co"],
            )
            entry = {
                "course_name": course_title.strip(),
                "raw_prerequisite_text": raw_text,
                "parsed": parsed,
                "normalized": normalized,
            }
            existing = courses.get(course_id)
            if existing is not None and existing["normalized"] != normalized:
                conflicting_course_ids.add(course_id)
            else:
                courses.setdefault(course_id, entry)

    return {"courses": courses, "conflicting_course_ids": conflicting_course_ids}


def _degree_requirements() -> dict:
    global _cache, _cache_loaded_at
    with _cache_lock:
        if _cache is not None and time.monotonic() - _cache_loaded_at < PREREQUISITE_CACHE_TTL_SECONDS:
            return _cache
        data = parse_degree_requirements(_download_page_html())
        _cache, _cache_loaded_at = data, time.monotonic()
        return data


def clear_cache() -> None:
    global _cache
    with _cache_lock:
        _cache = None


def parse_prerequisite_text(raw_text: str) -> dict:
    text_value = raw_text.strip()

    if text_value.lower() == "none":
        return {
            "relationship_type": "NONE",
            "is_pre_or_co": False,
            "prerequisite_groups": [],
            "additional_text_conditions": [],
        }

    is_pre_or_co = False
    remainder = text_value
    pre_co_match = re.match(r"^\s*pre\s*/\s*co\s*:?\s*", remainder, flags=re.IGNORECASE)
    if pre_co_match:
        is_pre_or_co = True
        remainder = remainder[pre_co_match.end():]

    # Top-level OR split; each branch may AND several course IDs.
    or_branches = re.split(r"\bor\b", remainder, flags=re.IGNORECASE)
    prerequisite_groups: list[list[int]] = []
    for branch in or_branches:
        ids_in_branch = [int(match) for match in _COURSE_ID_PATTERN.findall(branch)]
        if ids_in_branch:
            prerequisite_groups.append(ids_in_branch)

    # Whatever remains after removing course IDs and connectors is a free-text
    # condition, kept separate and never evaluated.
    residual = _COURSE_ID_PATTERN.sub(" ", remainder)
    residual_parts = re.split(r"\band\b|\bor\b|,", residual, flags=re.IGNORECASE)
    additional_text_conditions = [part.strip() for part in residual_parts if part.strip()]

    if not prerequisite_groups:
        relationship_type = "TEXT_ONLY"
    elif len(prerequisite_groups) == 1:
        relationship_type = "AND" if len(prerequisite_groups[0]) > 1 else "SINGLE"
    else:
        relationship_type = "OR"

    return {
        "relationship_type": relationship_type,
        "is_pre_or_co": is_pre_or_co,
        "prerequisite_groups": prerequisite_groups,
        "additional_text_conditions": additional_text_conditions,
    }


def get_course_prerequisites(course_id) -> dict:
    """verified=True with the structured prerequisite, or verified=False with the
    reason -- never a guessed prerequisite."""
    course_id = int(str(course_id).strip())
    base = {"course_id": course_id, "source_url": PREREQUISITE_SOURCE_URL, "source_scope": PREREQUISITE_SOURCE_SCOPE}
    try:
        page_data = _degree_requirements()
    except PrerequisiteSourceUnavailableError as exc:
        return {**base, "verified": False, "error": str(exc)}

    if course_id in page_data["conflicting_course_ids"]:
        return {
            **base,
            "verified": False,
            "error": (
                f"Conflicting prerequisite text found for course {course_id} across the UoS "
                "degree-requirements tables; cannot verify which is authoritative."
            ),
        }

    entry = page_data["courses"].get(course_id)
    if entry is None:
        return {
            **base,
            "verified": False,
            "error": (
                f"Course {course_id} was not found on the University of Sharjah Computer Science "
                "degree page, the only prerequisite source available to this agent."
            ),
        }

    parsed = entry["parsed"]
    return {
        **base,
        "course_name": entry["course_name"],
        "raw_prerequisite_text": entry["raw_prerequisite_text"],
        "relationship_type": parsed["relationship_type"],
        "is_pre_or_co": parsed["is_pre_or_co"],
        "prerequisite_groups": parsed["prerequisite_groups"],
        "additional_text_conditions": parsed["additional_text_conditions"],
        "source": "University of Sharjah",
        "verified": True,
    }


def _course_pass_status(course_id: int, transcript: list[dict]) -> str:
    """PASSED / NOT_PASSED / UNRESOLVED / NEVER_ATTEMPTED; any passing attempt counts."""
    attempts = [row for row in transcript if row["Course_ID"] == course_id]
    if not attempts:
        return "NEVER_ATTEMPTED"
    classifications = [classify_grade(row["Grade"]) for row in attempts]
    if any(c is True for c in classifications):
        return "PASSED"
    if any(c is None for c in classifications):
        return "UNRESOLVED"
    return "NOT_PASSED"


def _result(verified, relationship_type, satisfied, needs_manual_review, reason, additional, **lists) -> dict:
    return {
        "verified": verified,
        "relationship_type": relationship_type,
        "required_prerequisite_groups": lists.get("required_prerequisite_groups", []),
        "matched_transcript_courses": lists.get("matched_transcript_courses", []),
        "passed_courses": lists.get("passed_courses", []),
        "failed_or_incomplete_courses": lists.get("failed_or_incomplete_courses", []),
        "never_attempted": lists.get("never_attempted", []),
        "unresolved_grade_courses": lists.get("unresolved_grade_courses", []),
        "prerequisite_satisfied": satisfied,
        "needs_manual_review": needs_manual_review,
        "additional_text_conditions": additional,
        "reason": reason,
    }


def evaluate_prerequisite_status(prerequisite_data: dict, transcript: list[dict]) -> dict:
    """Deterministic comparison with the transcript under the approved grade policy.
    Never attempted, a failing grade and NULL/in progress do not satisfy; a grade
    outside the policy is unresolved (MANUAL_REVIEW)."""
    additional = prerequisite_data.get("additional_text_conditions", [])

    if not prerequisite_data.get("verified"):
        return _result(
            False, prerequisite_data.get("relationship_type"), None, True,
            prerequisite_data.get("error", "Prerequisite could not be verified from the UoS source."), additional,
        )

    relationship_type = prerequisite_data["relationship_type"]

    if relationship_type == "NONE":
        return _result(
            True, relationship_type, True, False,
            "University of Sharjah source explicitly lists no prerequisite for this course.", additional,
        )

    if relationship_type == "TEXT_ONLY":
        return _result(
            True, relationship_type, None, True,
            "The UoS prerequisite is expressed only as a text condition (no course ID), "
            "which cannot be evaluated automatically.",
            additional,
        )

    # The database returns Course_ID as text; parsed prerequisites are integers.
    transcript = [{**row, "Course_ID": int(str(row["Course_ID"]).strip())} for row in transcript]

    prerequisite_groups = prerequisite_data["prerequisite_groups"]
    all_required_ids = sorted({cid for group in prerequisite_groups for cid in group})
    transcript_ids_present = {row["Course_ID"] for row in transcript}
    matched = [cid for cid in all_required_ids if cid in transcript_ids_present]

    branch_reports = []
    for group in prerequisite_groups:
        statuses = {cid: _course_pass_status(cid, transcript) for cid in group}
        if all(s == "PASSED" for s in statuses.values()):
            state = "SATISFIED"
        elif any(s in ("NEVER_ATTEMPTED", "NOT_PASSED") for s in statuses.values()):
            state = "FAILED"
        else:
            state = "UNRESOLVED"
        branch_reports.append({"group": group, "statuses": statuses, "branch_state": state})

    common = {"required_prerequisite_groups": prerequisite_groups, "matched_transcript_courses": matched}

    satisfied_branch = next((b for b in branch_reports if b["branch_state"] == "SATISFIED"), None)
    if satisfied_branch is not None:
        return _result(
            True, relationship_type, True, False,
            f"Required course(s) {satisfied_branch['group']} were passed with a qualifying grade "
            "under the approved grade policy.",
            additional, passed_courses=list(satisfied_branch["group"]), **common,
        )

    unresolved_branch = next((b for b in branch_reports if b["branch_state"] == "UNRESOLVED"), None)
    if unresolved_branch is not None:
        unresolved_ids = [cid for cid, s in unresolved_branch["statuses"].items() if s == "UNRESOLVED"]
        return _result(
            True, relationship_type, None, True,
            f"Course(s) {unresolved_ids} have a recorded grade value that is not covered by the "
            "approved grade policy (neither listed as passing nor failing); cannot confirm.",
            additional, unresolved_grade_courses=unresolved_ids, **common,
        )

    never = sorted({cid for b in branch_reports for cid, s in b["statuses"].items() if s == "NEVER_ATTEMPTED"})
    not_passed = sorted({cid for b in branch_reports for cid, s in b["statuses"].items() if s == "NOT_PASSED"})
    return _result(
        True, relationship_type, False, False,
        f"Required prerequisite course(s) not satisfied: never attempted {never}; attempted without a "
        f"passing grade (failing grade or still in progress) {not_passed}.",
        additional, failed_or_incomplete_courses=not_passed, never_attempted=never, **common,
    )

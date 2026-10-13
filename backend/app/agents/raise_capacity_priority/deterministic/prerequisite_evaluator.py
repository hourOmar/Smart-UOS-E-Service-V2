"""
Deterministically evaluates whether a student satisfies a requested
course's official UoS prerequisite requirement, using the student's
Takes records and the approved grade policy. Never returns a priority —
only SATISFIED / NOT_SATISFIED / UNRESOLVED / CONFLICT plus the
evidence behind that status.

Design decisions worth stating explicitly (see Phase 4 report):

1. UoS conflict wins first. If Phase 3 found the prerequisite text
   materially disagrees across page sections (conflict=True), we do not
   pick a version to evaluate — status is CONFLICT immediately.

2. Choosing which source to evaluate. When there is no conflict, several
   sources may still exist (Degree Requirements, Study Plan, Course
   Description); we prefer Degree Requirements, then Study Plan, then
   Course Description, since that is the page's primary structured
   source (see Phase 3 notes).

3. A course leaf with NO Takes record at all is NOT_SATISFIED (a clear
   fact: never completed) — not UNRESOLVED. UNRESOLVED is reserved for
   a Takes record that exists but has a null/unrecognized grade, per
   the instruction that "a null/missing/unrecognized grade must not
   automatically count as passing or failing."

4. PRE_OR_CO. Ordinary PREREQUISITE course leaves are satisfied by any
   passing-grade Takes record for that course. PRE_OR_CO leaves are
   ALSO satisfied by a Takes record for that course whose Term equals
   the current request's own Term — a concurrent-registration fact we
   can check reliably from data we already have (no guessing about
   what "currently enrolled" means beyond term equality). If neither
   condition holds and no unresolved grade is present, PRE_OR_CO is
   NOT_SATISFIED like an ordinary prerequisite.

5. STANDING leaves (e.g. "Junior Standing") are always UNRESOLVED — we
   were given no reliable, confirmed way to derive class standing from
   the data available, and the instructions explicitly forbid guessing
   one (e.g. a Completed_Hours threshold was never confirmed).

6. AND/OR combination uses three-valued logic: AND is NOT_SATISFIED if
   any branch is NOT_SATISFIED (even if others are unresolved — the
   requirement is already unmet), SATISFIED only if every branch is
   SATISFIED, else UNRESOLVED. OR is the mirror.
"""

from typing import Optional

from ..deterministic.grade_policy import classify_grade
from ..retrieval.uos_prerequisite_parser import collect_course_ids
from ..schemas.academic_history import TakesRecord
from ..schemas.deterministic import (
    PrerequisiteCompletionEvidence,
    PrerequisiteLeafEvaluation,
    TakesRecordEvaluation,
)
from ..schemas.uos import ParsedPrerequisite, PrerequisiteEvidence, PrerequisiteNode

_SOURCE_PRIORITY = ("DEGREE_REQUIREMENTS", "STUDY_PLAN", "COURSE_DESCRIPTION")


def required_prerequisite_course_ids(uos_prereq_evidence: PrerequisiteEvidence) -> set[int]:
    """Every course_id referenced across ALL sources — a superset used
    to fetch Takes records once, regardless of which single source ends
    up being evaluated."""
    ids: set[int] = set()
    for parsed in uos_prereq_evidence.by_source:
        ids |= collect_course_ids(parsed.expression)
    return ids


def evaluate_prerequisite_completion(
    course_id: int,
    uos_prereq_evidence: PrerequisiteEvidence,
    takes_records: list[TakesRecord],
    current_request_term: Optional[int],
) -> PrerequisiteCompletionEvidence:
    if uos_prereq_evidence.conflict:
        return PrerequisiteCompletionEvidence(
            course_id=course_id,
            status="CONFLICT",
            reason=(
                "UoS prerequisite information conflicts across page "
                "sections; not choosing one version."
            ),
            source_section_used=None,
            relation=None,
            requirement_expression=None,
            leaf_evaluations=[],
            uos_conflict=True,
            uos_conflict_reason=uos_prereq_evidence.conflict_reason,
        )

    if not uos_prereq_evidence.course_found:
        return PrerequisiteCompletionEvidence(
            course_id=course_id,
            status="UNRESOLVED",
            reason="This course's prerequisite requirement was not found on the official UoS page.",
            source_section_used=None,
            relation=None,
            requirement_expression=None,
            leaf_evaluations=[],
            uos_conflict=False,
            uos_conflict_reason=None,
        )

    chosen = _select_primary_source(uos_prereq_evidence.by_source)
    if chosen is None:
        raw_texts = "; ".join(p.raw_text for p in uos_prereq_evidence.by_source)
        return PrerequisiteCompletionEvidence(
            course_id=course_id,
            status="UNRESOLVED",
            reason=f"Prerequisite text could not be parsed into a structure: {raw_texts}",
            source_section_used=None,
            relation=None,
            requirement_expression=None,
            leaf_evaluations=[],
            uos_conflict=False,
            uos_conflict_reason=None,
        )

    leaves: list[PrerequisiteLeafEvaluation] = []
    overall_status = _evaluate_node(
        chosen.expression, takes_records, chosen.relation, current_request_term, leaves
    )

    return PrerequisiteCompletionEvidence(
        course_id=course_id,
        status=overall_status,
        reason=_overall_reason(overall_status, chosen),
        source_section_used=chosen.source_section,
        relation=chosen.relation,
        requirement_expression=chosen.expression,
        leaf_evaluations=leaves,
        uos_conflict=False,
        uos_conflict_reason=None,
    )


def _select_primary_source(by_source: list[ParsedPrerequisite]) -> Optional[ParsedPrerequisite]:
    by_section = {p.source_section: p for p in by_source if p.parseable}
    for section in _SOURCE_PRIORITY:
        if section in by_section:
            return by_section[section]
    return None


def _overall_reason(status: str, chosen: ParsedPrerequisite) -> str:
    if chosen.expression is None:
        return "No prerequisite is required for this course."
    return (
        f"Evaluated from {chosen.source_section} ({chosen.relation}) "
        f"raw text {chosen.raw_text!r}: {status}."
    )


def _evaluate_node(
    node: Optional[PrerequisiteNode],
    takes_records: list[TakesRecord],
    relation: str,
    current_request_term: Optional[int],
    leaves: list[PrerequisiteLeafEvaluation],
) -> str:
    if node is None:
        return "SATISFIED"

    if node.kind == "STANDING":
        leaves.append(
            PrerequisiteLeafEvaluation(
                kind="STANDING",
                course_id=None,
                standing_text=node.text,
                status="UNRESOLVED",
                reason=(
                    "Standing requirements cannot be verified "
                    "deterministically from the available data."
                ),
                matched_takes_records=[],
            )
        )
        return "UNRESOLVED"

    if node.kind == "COURSE":
        leaf = _evaluate_course_leaf(node.course_id, takes_records, relation, current_request_term)
        leaves.append(leaf)
        return leaf.status

    # GROUP
    child_statuses = [
        _evaluate_node(child, takes_records, relation, current_request_term, leaves)
        for child in node.items
    ]
    if node.operator == "AND":
        if any(status == "NOT_SATISFIED" for status in child_statuses):
            return "NOT_SATISFIED"
        if all(status == "SATISFIED" for status in child_statuses):
            return "SATISFIED"
        return "UNRESOLVED"

    # OR
    if any(status == "SATISFIED" for status in child_statuses):
        return "SATISFIED"
    if all(status == "NOT_SATISFIED" for status in child_statuses):
        return "NOT_SATISFIED"
    return "UNRESOLVED"


def _evaluate_course_leaf(
    course_id: int,
    takes_records: list[TakesRecord],
    relation: str,
    current_request_term: Optional[int],
) -> PrerequisiteLeafEvaluation:
    matching = [record for record in takes_records if record.course_id == course_id]

    if not matching:
        return PrerequisiteLeafEvaluation(
            kind="COURSE",
            course_id=course_id,
            standing_text=None,
            status="NOT_SATISFIED",
            reason=f"No Takes record found for course {course_id}.",
            matched_takes_records=[],
        )

    matched_evaluations: list[TakesRecordEvaluation] = []
    passing_found = False
    concurrent_found = False
    unresolved_found = False

    for record in matching:
        grade_status = classify_grade(record.grade)
        matched_evaluations.append(
            TakesRecordEvaluation(
                course_id=record.course_id,
                grade=record.grade,
                term=record.term,
                grade_status=grade_status,
            )
        )
        if grade_status == "PASSING":
            passing_found = True
        elif grade_status in ("MISSING", "UNRECOGNIZED"):
            unresolved_found = True
        if (
            relation == "PRE_OR_CO"
            and current_request_term is not None
            and record.term == current_request_term
        ):
            concurrent_found = True

    if passing_found:
        return PrerequisiteLeafEvaluation(
            kind="COURSE",
            course_id=course_id,
            standing_text=None,
            status="SATISFIED",
            reason=f"A passing grade was found for course {course_id}.",
            matched_takes_records=matched_evaluations,
        )

    if relation == "PRE_OR_CO" and concurrent_found:
        return PrerequisiteLeafEvaluation(
            kind="COURSE",
            course_id=course_id,
            standing_text=None,
            status="SATISFIED",
            reason=(
                f"Concurrent registration in course {course_id} during the "
                "same term as this request satisfies the Pre/Co requirement."
            ),
            matched_takes_records=matched_evaluations,
        )

    if unresolved_found:
        return PrerequisiteLeafEvaluation(
            kind="COURSE",
            course_id=course_id,
            standing_text=None,
            status="UNRESOLVED",
            reason=(
                f"Existing Takes record(s) for course {course_id} have a "
                "null/unrecognized grade; completion cannot be determined."
            ),
            matched_takes_records=matched_evaluations,
        )

    return PrerequisiteLeafEvaluation(
        kind="COURSE",
        course_id=course_id,
        standing_text=None,
        status="NOT_SATISFIED",
        reason=f"No passing grade found for course {course_id}.",
        matched_takes_records=matched_evaluations,
    )

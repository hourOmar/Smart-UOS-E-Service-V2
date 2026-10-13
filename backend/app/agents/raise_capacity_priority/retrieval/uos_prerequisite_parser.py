"""
Parses a single raw prerequisite-cell string from the UoS CS page into a
structured PrerequisiteNode tree, and provides small tree-walking helpers
used for cross-source conflict detection and subsequent-course discovery.

This module knows nothing about HTML — it only turns text like
"1501341, (1501246 or 1501247)" or "1501215 and Junior Standing" into a
PrerequisiteNode. Real formats observed on the live page that this parser
must handle:

    "None"                                  -> no prerequisite
    "-"                                      -> no prerequisite (Study Plan)
    "1440132"                                -> single course
    "1501215, 1501279"                       -> AND (comma)
    "1501215; 1501279"                       -> AND (semicolon; same meaning
                                                 as comma, just inconsistent
                                                 punctuation on the page)
    "1501211 or 1501341"                     -> OR
    "1501341, (1501246 or 1501247)"          -> AND of [course, OR-group]
    "Pre/Co: 1430110"                        -> Pre/Co relation, single course
    "Pre/Co: 1430110 or 1430115"             -> Pre/Co relation, OR group
    "1501215 and Junior Standing"            -> AND of [course, standing]
    "Junior Standing, 1501215"               -> AND of [standing, course]
    "Junior/Senior standing"                 -> standing only (kept as one
                                                 atomic text — we do not
                                                 invent an OR split on "/")
    "Prerequisite: 1501116 Programming I"    -> "Prerequisite:"/"Perquisite:"
    "Perquisite: None"                          label stripped (Course
                                                 Description prose; the page
                                                 itself misspells it once)

Anything that does not match a known shape is preserved with
parseable=False rather than guessed at.
"""

import re
from typing import Optional

from ..schemas.uos import (
    ParsedPrerequisite,
    PrerequisiteCourseRef,
    PrerequisiteGroup,
    PrerequisiteNode,
    PrerequisiteStanding,
    SourceSection,
)

_NONE_VALUES = {"none", "-", "n/a", "na", ""}
_PRE_CO_RE = re.compile(r"^\s*pre\s*/\s*co\s*:\s*(.*)$", re.IGNORECASE)
_PREREQ_LABEL_RE = re.compile(
    r"^\s*(?:prerequisite|perquisite|pre-requisite)\s*:\s*(.*)$", re.IGNORECASE
)
_COURSE_ID_RE = re.compile(r"\b\d{7}\b")
_AND_SEPARATORS = [r",", r";", r"\band\b"]
_OR_SEPARATORS = [r"\bor\b"]


class PrerequisiteParseFailure(Exception):
    """Raised internally when a prerequisite fragment does not match any
    known shape. Callers should catch this and fall back to
    parseable=False rather than let it propagate."""


def parse_prerequisite_text(
    raw_text: Optional[str], source_section: SourceSection
) -> ParsedPrerequisite:
    original = raw_text or ""
    text = original.strip()

    relation = "PREREQUISITE"

    pre_co_match = _PRE_CO_RE.match(text)
    if pre_co_match:
        relation = "PRE_OR_CO"
        text = pre_co_match.group(1).strip()

    label_match = _PREREQ_LABEL_RE.match(text)
    if label_match:
        text = label_match.group(1).strip()

    if text.lower() in _NONE_VALUES:
        return ParsedPrerequisite(
            source_section=source_section,
            raw_text=original,
            relation=relation,
            expression=None,
            parseable=True,
        )

    try:
        expression = _parse_and_level(text)
    except PrerequisiteParseFailure:
        return ParsedPrerequisite(
            source_section=source_section,
            raw_text=original,
            relation=relation,
            expression=None,
            parseable=False,
        )

    return ParsedPrerequisite(
        source_section=source_section,
        raw_text=original,
        relation=relation,
        expression=expression,
        parseable=True,
    )


def _split_top_level(text: str, separator_patterns: list[str]) -> list[str]:
    """Split text on the given regex alternatives, only at paren-depth 0,
    so a separator word/character inside "(...)" is not treated as a
    split point."""
    pattern = re.compile("|".join(separator_patterns), re.IGNORECASE)
    parts: list[str] = []
    current: list[str] = []
    depth = 0
    i = 0
    n = len(text)
    while i < n:
        char = text[i]
        if char == "(":
            depth += 1
            current.append(char)
            i += 1
            continue
        if char == ")":
            depth -= 1
            current.append(char)
            i += 1
            continue
        if depth == 0:
            match = pattern.match(text, i)
            if match and match.end() > match.start():
                parts.append("".join(current))
                current = []
                i = match.end()
                continue
        current.append(char)
        i += 1
    parts.append("".join(current))
    return [p.strip() for p in parts if p.strip()]


def _is_balanced_wrap(text: str) -> bool:
    if not (text.startswith("(") and text.endswith(")")):
        return False
    depth = 0
    for index, char in enumerate(text):
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0 and index != len(text) - 1:
                return False
    return depth == 0


def _parse_and_level(text: str) -> PrerequisiteNode:
    text = text.strip()
    if not text:
        raise PrerequisiteParseFailure("empty expression")

    parts = _split_top_level(text, _AND_SEPARATORS)
    if not parts:
        raise PrerequisiteParseFailure("empty expression")
    if len(parts) == 1:
        return _parse_or_level(parts[0])
    return PrerequisiteGroup(operator="AND", items=[_parse_or_level(p) for p in parts])


def _parse_or_level(text: str) -> PrerequisiteNode:
    text = text.strip()
    if _is_balanced_wrap(text):
        return _parse_and_level(text[1:-1].strip())

    parts = _split_top_level(text, _OR_SEPARATORS)
    if not parts:
        raise PrerequisiteParseFailure("empty expression")
    if len(parts) == 1:
        return _parse_group_or_atom(parts[0])
    return PrerequisiteGroup(
        operator="OR", items=[_parse_group_or_atom(p) for p in parts]
    )


def _parse_group_or_atom(text: str) -> PrerequisiteNode:
    text = text.strip()
    if _is_balanced_wrap(text):
        return _parse_and_level(text[1:-1].strip())
    return _parse_atom(text)


def _parse_atom(text: str) -> PrerequisiteNode:
    text = text.strip().strip(".").strip()
    if not text:
        raise PrerequisiteParseFailure("empty atom")

    course_match = _COURSE_ID_RE.search(text)
    if course_match:
        return PrerequisiteCourseRef(course_id=int(course_match.group(0)), raw_text=text)

    return PrerequisiteStanding(text=text)


def find_course_reference_occurrences(
    node: Optional[PrerequisiteNode], target_course_id: int
) -> list[bool]:
    """One entry per occurrence of target_course_id in the tree: True if
    that occurrence is not nested inside any OR group (unconditionally
    required), False if it is one alternative among OR options."""
    if node is None:
        return []
    return _walk_for_course(node, target_course_id, inside_or=False)


def _walk_for_course(
    node: PrerequisiteNode, target_course_id: int, inside_or: bool
) -> list[bool]:
    if node.kind == "COURSE":
        return [not inside_or] if node.course_id == target_course_id else []
    if node.kind == "STANDING":
        return []
    child_inside_or = inside_or or node.operator == "OR"
    results: list[bool] = []
    for item in node.items:
        results.extend(_walk_for_course(item, target_course_id, child_inside_or))
    return results


def collect_course_ids(node: Optional[PrerequisiteNode]) -> set[int]:
    if node is None:
        return set()
    if node.kind == "COURSE":
        return {node.course_id}
    if node.kind == "STANDING":
        return set()
    result: set[int] = set()
    for item in node.items:
        result |= collect_course_ids(item)
    return result


def collect_standing_texts(node: Optional[PrerequisiteNode]) -> set[str]:
    if node is None:
        return set()
    if node.kind == "STANDING":
        return {node.text.strip().lower()}
    if node.kind == "COURSE":
        return set()
    result: set[str] = set()
    for item in node.items:
        result |= collect_standing_texts(item)
    return result


def top_level_operator(node: Optional[PrerequisiteNode]) -> Optional[str]:
    if node is not None and node.kind == "GROUP":
        return node.operator
    return None

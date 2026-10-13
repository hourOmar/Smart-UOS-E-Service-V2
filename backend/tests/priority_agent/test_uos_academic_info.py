"""
Integration-level tests for the UoS retrieval layer, using the controlled
fixture at tests/fixtures/uos_cs_page_sample.html so nothing here
depends on the live website.
"""

from pathlib import Path

import pytest

from app.agents.raise_capacity_priority.retrieval import uos_academic_info as academic_info
from app.agents.raise_capacity_priority.retrieval.uos_errors import UoSPageStructureError

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "uos_cs_page_sample.html"
SAMPLE_HTML = FIXTURE_PATH.read_text(encoding="utf-8")

_MINIMAL_HTML_MISSING_SECTIONS = "<html><body><p>Nothing useful here.</p></body></html>"


# 1. Total degree credits parsing
def test_total_degree_credits_parsing():
    evidence = academic_info.get_total_degree_credits(html=SAMPLE_HTML)
    assert evidence.total_required_credits == 123
    assert evidence.verified is True
    assert evidence.retrieval_status == "OK"


# 2. Mandatory course classification
def test_mandatory_course_classification():
    evidence = academic_info.get_course_category(1440131, html=SAMPLE_HTML)
    assert evidence.found is True
    assert evidence.category == "MANDATORY"
    assert evidence.specific_course_mandatory is True


# 3. Mandatory Core classification
def test_mandatory_core_classification():
    evidence = academic_info.get_course_category(1501215, html=SAMPLE_HTML)
    assert evidence.category == "MANDATORY_CORE"
    assert evidence.specific_course_mandatory is True
    assert evidence.course_name == "Data Structures"


# 4. Elective classification
def test_elective_classification_is_not_individually_mandatory():
    evidence = academic_info.get_course_category(1501341, html=SAMPLE_HTML)
    assert evidence.category == "ELECTIVE"
    assert evidence.specific_course_mandatory is False


# 5-11 (no prerequisite / single / multiple / OR / Pre-Co / standing /
# course+standing) are covered directly against real text patterns in
# tests/test_uos_prerequisite_parser.py; here we confirm the same shapes
# come through correctly once routed through actual HTML table cells.
def test_prerequisite_shapes_survive_html_extraction():
    none_case = academic_info.get_course_prerequisites(1501116, html=SAMPLE_HTML)
    assert none_case.by_source[0].expression is None

    single_case = academic_info.get_course_prerequisites(1501211, html=SAMPLE_HTML)
    assert single_case.by_source[0].expression.course_id == 1501116

    and_case = academic_info.get_course_prerequisites(1501279, html=SAMPLE_HTML)
    assert and_case.by_source[0].expression.course_id == 1440131

    or_case = academic_info.get_course_prerequisites(1501445, html=SAMPLE_HTML)
    assert or_case.by_source[0].expression.operator == "OR"

    pre_co_case = academic_info.get_course_prerequisites(1430116, html=SAMPLE_HTML)
    assert pre_co_case.by_source[0].relation == "PRE_OR_CO"

    standing_case = academic_info.get_course_prerequisites(1501397, html=SAMPLE_HTML)
    assert standing_case.by_source[0].expression.kind == "STANDING"

    course_and_standing_case = academic_info.get_course_prerequisites(1501394, html=SAMPLE_HTML)
    assert course_and_standing_case.by_source[0].expression.operator == "AND"


# 12. Course not found
def test_course_not_found():
    category = academic_info.get_course_category(9999999, html=SAMPLE_HTML)
    assert category.found is False
    assert category.category is None
    assert category.specific_course_mandatory is None

    prereq = academic_info.get_course_prerequisites(9999999, html=SAMPLE_HTML)
    assert prereq.course_found is False
    assert prereq.by_source == []


# 13. Dependent-course discovery
def test_dependent_course_discovery():
    impact = academic_info.get_subsequent_course_impact(1501211, html=SAMPLE_HTML)
    dependent_ids = {course.course_id for course in impact.dependent_courses}
    assert 1501215 in dependent_ids
    assert 1501211 not in dependent_ids  # a course never depends on itself


# 14. Mandatory vs elective dependent courses
def test_dependent_courses_distinguish_mandatory_from_elective():
    impact = academic_info.get_subsequent_course_impact(1501211, html=SAMPLE_HTML)
    by_id = {course.course_id: course for course in impact.dependent_courses}

    assert by_id[1501215].category == "MANDATORY_CORE"
    assert by_id[1501215].specific_course_mandatory is True
    assert by_id[1501215].always_required is True

    assert by_id[1501445].category == "ELECTIVE"
    assert by_id[1501445].specific_course_mandatory is False
    assert by_id[1501445].always_required is False  # only one OR-alternative

    assert impact.dependent_mandatory_or_core_count == 1
    assert impact.dependent_elective_count == 1


# 15. Duplicate/equivalent information (comma vs semicolon — same meaning)
def test_duplicate_equivalent_prerequisite_information_is_consistent():
    evidence = academic_info.get_course_prerequisites(1501371, html=SAMPLE_HTML)
    assert len(evidence.by_source) == 2
    assert evidence.consistent is True
    assert evidence.conflict is False


# 16. Conflicting prerequisite information
def test_conflicting_prerequisite_information_is_flagged():
    evidence = academic_info.get_course_prerequisites(1430116, html=SAMPLE_HTML)
    assert evidence.consistent is False
    assert evidence.conflict is True
    assert evidence.conflict_reason is not None
    assert "DEGREE_REQUIREMENTS" in evidence.conflict_reason
    assert "STUDY_PLAN" in evidence.conflict_reason


# 17. Missing expected HTML section
def test_missing_degree_requirements_section_raises():
    with pytest.raises(UoSPageStructureError):
        academic_info.get_course_category(1501215, html=_MINIMAL_HTML_MISSING_SECTIONS)


def test_missing_course_description_section_raises():
    from app.agents.raise_capacity_priority.retrieval.uos_html_parser import parse_course_description_rows
    from bs4 import BeautifulSoup

    with pytest.raises(UoSPageStructureError):
        parse_course_description_rows(BeautifulSoup(_MINIMAL_HTML_MISSING_SECTIONS, "html.parser"))


def test_total_credits_not_found_is_represented_explicitly_not_guessed():
    evidence = academic_info.get_total_degree_credits(html=_MINIMAL_HTML_MISSING_SECTIONS)
    assert evidence.total_required_credits is None
    assert evidence.verified is False
    assert evidence.retrieval_status == "NOT_FOUND"


# 18. Website/network failure — see tests/test_uos_client.py for the
# HTTP-layer failures (timeout, non-200); here we confirm the retrieval
# layer propagates a fetch failure rather than swallowing it.
def test_fetch_failure_propagates(monkeypatch):
    from app.agents.raise_capacity_priority.integrations.uos_client import UoSPageFetchError

    def _boom(timeout=20.0):
        raise UoSPageFetchError("simulated network failure")

    monkeypatch.setattr(academic_info, "fetch_cs_degree_page", _boom)

    with pytest.raises(UoSPageFetchError):
        academic_info.get_total_degree_credits()


def test_full_course_evidence_bundle_shape():
    evidence = academic_info.get_uos_course_evidence(1501215, html=SAMPLE_HTML)
    assert evidence.course_id == 1501215
    assert evidence.total_degree_credits.total_required_credits == 123
    assert evidence.category.category == "MANDATORY_CORE"
    assert evidence.prerequisites.course_found is True
    assert evidence.study_plan_entry is not None
    assert evidence.study_plan_entry.year == 2
    assert evidence.study_plan_entry.semester == 2

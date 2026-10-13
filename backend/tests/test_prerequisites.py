import pytest

from app.agents.raise_capacity_eligibility.tools import prerequisites as pr

# A page shaped like the UoS degree page: tables inside #degree-requirements, four
# cells per course row, some courses listed twice (flat table + study plan).
PAGE = """
<html><body><div id="degree-requirements">
<table>
  <tr><td>Course #</td><td>Course Title</td><td>Cr. Hr.</td><td>Prerequisite</td></tr>
  <tr><td>1501100</td><td>Intro</td><td>3</td><td>None</td></tr>
  <tr><td>1501211</td><td>Programming</td><td>3</td><td>1501100</td></tr>
  <tr><td>1501279</td><td>Data Structures</td><td>3</td><td>1501211 or 1501341</td></tr>
  <tr><td>1501300</td><td>Systems</td><td>3</td><td>1501215, 1501279</td></tr>
  <tr><td>1501394</td><td>Junior Project</td><td>3</td><td>1501215 and Junior Standing</td></tr>
  <tr><td>1501400</td><td>Seminar</td><td>1</td><td>Senior Standing</td></tr>
  <tr><td>1501410</td><td>Lab</td><td>1</td><td>Pre/Co: 1430110</td></tr>
  <tr><td>1501500</td><td>Conflicted</td><td>3</td><td>1501211</td></tr>
</table>
<table>
  <tr><td>1501394</td><td>Junior Project</td><td>3</td><td>Junior Standing, 1501215</td></tr>
  <tr><td>1501500</td><td>Conflicted</td><td>3</td><td>1501279</td></tr>
</table>
</div></body></html>
"""


@pytest.fixture
def page(monkeypatch):
    calls = {"n": 0}

    def fake_download():
        calls["n"] += 1
        return PAGE

    pr.clear_cache()
    monkeypatch.setattr(pr, "_download_page_html", fake_download)
    yield calls
    pr.clear_cache()


@pytest.mark.parametrize(
    ("text", "relationship", "groups", "conditions", "pre_co"),
    [
        ("None", "NONE", [], [], False),
        ("1501211", "SINGLE", [[1501211]], [], False),
        ("1501215, 1501279", "AND", [[1501215, 1501279]], [], False),
        ("1501211 or 1501341", "OR", [[1501211], [1501341]], [], False),
        ("Pre/Co: 1430110", "SINGLE", [[1430110]], [], True),
        ("1501215 and Junior Standing", "SINGLE", [[1501215]], ["Junior Standing"], False),
        ("Senior Standing", "TEXT_ONLY", [], ["Senior Standing"], False),
    ],
)
def test_parse_prerequisite_text_keeps_relationships(text, relationship, groups, conditions, pre_co):
    parsed = pr.parse_prerequisite_text(text)
    assert parsed["relationship_type"] == relationship
    assert parsed["prerequisite_groups"] == groups
    assert parsed["additional_text_conditions"] == conditions
    assert parsed["is_pre_or_co"] is pre_co


def test_reworded_duplicate_is_not_a_conflict_but_a_real_difference_is():
    data = pr.parse_degree_requirements(PAGE)
    assert 1501394 not in data["conflicting_course_ids"]
    assert 1501500 in data["conflicting_course_ids"]


def test_verified_prerequisite_carries_source_and_scope(page):
    result = pr.get_course_prerequisites("1501279")  # text, as stored in the database
    assert result["verified"] is True
    assert result["prerequisite_groups"] == [[1501211], [1501341]]
    assert result["source_url"] == pr.PREREQUISITE_SOURCE_URL
    assert "Computer Science" in result["source_scope"]


def test_course_not_on_the_computer_science_page_is_unverified_not_guessed(page):
    result = pr.get_course_prerequisites("0201101")
    assert result["verified"] is False
    assert "Computer Science degree page" in result["error"]
    evaluation = pr.evaluate_prerequisite_status(result, [])
    assert evaluation["prerequisite_satisfied"] is None
    assert evaluation["needs_manual_review"] is True


def test_conflicting_course_is_unverified(page):
    assert pr.get_course_prerequisites(1501500)["verified"] is False


def test_page_cache_expires(page, monkeypatch):
    now = {"t": 1000.0}
    monkeypatch.setattr(pr.time, "monotonic", lambda: now["t"])
    pr.get_course_prerequisites(1501211)
    pr.get_course_prerequisites(1501279)
    assert page["n"] == 1  # cached
    now["t"] += pr.PREREQUISITE_CACHE_TTL_SECONDS + 1
    pr.get_course_prerequisites(1501211)
    assert page["n"] == 2  # fetched again after expiry


def test_unreachable_page_is_unverified_and_not_cached(monkeypatch):
    pr.clear_cache()
    attempts = {"n": 0}

    def failing():
        attempts["n"] += 1
        raise pr.PrerequisiteSourceUnavailableError("down")

    monkeypatch.setattr(pr, "_download_page_html", failing)
    assert pr.get_course_prerequisites(1501211)["verified"] is False
    assert pr.get_course_prerequisites(1501211)["verified"] is False
    assert attempts["n"] == 2
    pr.clear_cache()


def _evaluate(page_course_id, transcript):
    return pr.evaluate_prerequisite_status(pr.get_course_prerequisites(page_course_id), transcript)


def row(course_id, grade):
    return {"Course_ID": course_id, "Grade": grade, "Term": 202501, "Section_ID": "1", "Course_Name": "x"}


def test_passed_with_text_course_ids_from_the_database(page):
    result = _evaluate(1501211, [row("1501100", "B")])
    assert result["prerequisite_satisfied"] is True


@pytest.mark.parametrize(
    ("grade", "expected"),
    [("D", True), ("F", False), ("WF", False), ("FA", False), (None, False), ("P", None)],
)
def test_grade_policy_outcomes(page, grade, expected):
    assert _evaluate(1501211, [row("1501100", grade)])["prerequisite_satisfied"] is expected


def test_never_attempted_is_a_confirmed_failure(page):
    result = _evaluate(1501211, [])
    assert result["prerequisite_satisfied"] is False
    assert result["never_attempted"] == [1501100]


def test_or_prerequisite_needs_one_branch(page):
    assert _evaluate(1501279, [row("1501341", "C")])["prerequisite_satisfied"] is True


def test_and_prerequisite_needs_every_course(page):
    assert _evaluate(1501300, [row("1501215", "A")])["prerequisite_satisfied"] is False


def test_text_only_prerequisite_is_unresolved(page):
    result = _evaluate(1501400, [])
    assert result["prerequisite_satisfied"] is None
    assert result["needs_manual_review"] is True


def test_no_prerequisite_is_satisfied(page):
    assert _evaluate(1501100, [])["prerequisite_satisfied"] is True

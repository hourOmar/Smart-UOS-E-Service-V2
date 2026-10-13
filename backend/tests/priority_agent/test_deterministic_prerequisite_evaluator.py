from app.agents.raise_capacity_priority.deterministic.prerequisite_evaluator import evaluate_prerequisite_completion
from app.agents.raise_capacity_priority.retrieval.uos_prerequisite_parser import parse_prerequisite_text
from app.agents.raise_capacity_priority.schemas.academic_history import TakesRecord
from app.agents.raise_capacity_priority.schemas.uos import ParsedPrerequisite, PrerequisiteEvidence

SOURCE_URL = "https://www.sharjah.ac.ae/en/Academics/Degree/Undergraduate/Computer-Science"


def _evidence(raw_text: str, source_section: str = "DEGREE_REQUIREMENTS") -> PrerequisiteEvidence:
    parsed = parse_prerequisite_text(raw_text, source_section)
    return PrerequisiteEvidence(
        course_id=1501215,
        course_found=True,
        by_source=[parsed],
        consistent=True,
        conflict=False,
        conflict_reason=None,
        source_url=SOURCE_URL,
    )


def _take(course_id: int, grade, term: int = 202502) -> TakesRecord:
    return TakesRecord(course_id=course_id, grade=grade, section_id="SEC-1", term=term)


# 9. No prerequisite
def test_no_prerequisite_is_satisfied():
    result = evaluate_prerequisite_completion(1501215, _evidence("None"), [], 202601)
    assert result.status == "SATISFIED"


# 10. Single satisfied prerequisite
def test_single_satisfied_prerequisite():
    result = evaluate_prerequisite_completion(
        1501215, _evidence("1501211"), [_take(1501211, "B")], 202601
    )
    assert result.status == "SATISFIED"


# 11. Single failed prerequisite
def test_single_failed_prerequisite():
    result = evaluate_prerequisite_completion(
        1501215, _evidence("1501211"), [_take(1501211, "F")], 202601
    )
    assert result.status == "NOT_SATISFIED"


def test_single_prerequisite_never_attempted():
    result = evaluate_prerequisite_completion(1501215, _evidence("1501211"), [], 202601)
    assert result.status == "NOT_SATISFIED"


# 12. AND all satisfied
def test_and_all_satisfied():
    takes = [_take(1501215, "A"), _take(1501279, "C")]
    result = evaluate_prerequisite_completion(
        1501371, _evidence("1501215, 1501279"), takes, 202601
    )
    assert result.status == "SATISFIED"


# 13. AND one failed
def test_and_one_failed():
    takes = [_take(1501215, "A"), _take(1501279, "F")]
    result = evaluate_prerequisite_completion(
        1501371, _evidence("1501215, 1501279"), takes, 202601
    )
    assert result.status == "NOT_SATISFIED"


# 14. OR one satisfied
def test_or_one_satisfied():
    takes = [_take(1501211, "B")]
    result = evaluate_prerequisite_completion(
        1501445, _evidence("1501211 or 1501341"), takes, 202601
    )
    assert result.status == "SATISFIED"


# 15. OR all failed
def test_or_all_failed():
    takes = [_take(1501211, "F"), _take(1501341, "WF")]
    result = evaluate_prerequisite_completion(
        1501445, _evidence("1501211 or 1501341"), takes, 202601
    )
    assert result.status == "NOT_SATISFIED"


# 16. Nested AND/OR
def test_nested_and_or_satisfied():
    takes = [_take(1501341, "A"), _take(1501246, "B")]
    result = evaluate_prerequisite_completion(
        1501443, _evidence("1501341, (1501246 or 1501247)"), takes, 202601
    )
    assert result.status == "SATISFIED"


def test_nested_and_or_not_satisfied_when_and_branch_fails():
    takes = [_take(1501341, "F"), _take(1501246, "B")]
    result = evaluate_prerequisite_completion(
        1501443, _evidence("1501341, (1501246 or 1501247)"), takes, 202601
    )
    assert result.status == "NOT_SATISFIED"


# 17. Standing requirement unresolved
def test_standing_requirement_is_unresolved():
    result = evaluate_prerequisite_completion(
        1501397, _evidence("Junior/Senior standing"), [], 202601
    )
    assert result.status == "UNRESOLVED"
    assert result.leaf_evaluations[0].kind == "STANDING"


def test_course_and_standing_is_unresolved_even_if_course_satisfied():
    takes = [_take(1501215, "A")]
    result = evaluate_prerequisite_completion(
        1501394, _evidence("1501215 and Junior Standing"), takes, 202601
    )
    assert result.status == "UNRESOLVED"


# 18. PRE_OR_CO handling
def test_pre_or_co_satisfied_by_completion():
    takes = [_take(1430110, "A", term=202502)]
    result = evaluate_prerequisite_completion(
        1430116, _evidence("Pre/Co: 1430110"), takes, 202601
    )
    assert result.status == "SATISFIED"


def test_pre_or_co_satisfied_by_concurrent_registration():
    takes = [_take(1430110, None, term=202601)]  # in-progress this same term
    result = evaluate_prerequisite_completion(
        1430116, _evidence("Pre/Co: 1430110"), takes, 202601
    )
    assert result.status == "SATISFIED"
    assert "Concurrent" in result.leaf_evaluations[0].reason


def test_pre_or_co_not_satisfied_when_no_completion_or_concurrent_record():
    takes = [_take(1430110, "F", term=202410)]
    result = evaluate_prerequisite_completion(
        1430116, _evidence("Pre/Co: 1430110"), takes, 202601
    )
    assert result.status == "NOT_SATISFIED"


def test_ordinary_prerequisite_not_satisfied_by_same_term_record_alone():
    # Unlike PRE_OR_CO, an ordinary PREREQUISITE is not satisfied merely
    # by an in-progress same-term record with no passing grade.
    takes = [_take(1501211, None, term=202601)]
    result = evaluate_prerequisite_completion(1501215, _evidence("1501211"), takes, 202601)
    assert result.status == "UNRESOLVED"


# 19. UoS prerequisite conflict
def test_uos_conflict_returns_conflict_status_without_choosing_a_version():
    evidence = PrerequisiteEvidence(
        course_id=1501252,
        course_found=True,
        by_source=[
            parse_prerequisite_text("1502201", "DEGREE_REQUIREMENTS"),
            parse_prerequisite_text("1403201", "STUDY_PLAN"),
        ],
        consistent=False,
        conflict=True,
        conflict_reason="Prerequisite text differs materially across sections.",
        source_url=SOURCE_URL,
    )
    result = evaluate_prerequisite_completion(1501252, evidence, [], 202601)
    assert result.status == "CONFLICT"
    assert result.uos_conflict is True


def test_course_not_found_on_uos_page_is_unresolved():
    evidence = PrerequisiteEvidence(
        course_id=9999999,
        course_found=False,
        by_source=[],
        consistent=True,
        conflict=False,
        conflict_reason=None,
        source_url=SOURCE_URL,
    )
    result = evaluate_prerequisite_completion(9999999, evidence, [], 202601)
    assert result.status == "UNRESOLVED"


def test_unparseable_prerequisite_text_is_unresolved():
    # Constructed directly (rather than via parse_prerequisite_text,
    # which is intentionally permissive and rarely fails) to exercise
    # the "nothing parseable" branch: genuinely ambiguous UoS text
    # should stay unresolved, never guessed as satisfied or not.
    unparseable = ParsedPrerequisite(
        source_section="DEGREE_REQUIREMENTS",
        raw_text="some format this parser does not recognize",
        relation="PREREQUISITE",
        expression=None,
        parseable=False,
    )
    evidence = PrerequisiteEvidence(
        course_id=1501215,
        course_found=True,
        by_source=[unparseable],
        consistent=True,
        conflict=False,
        conflict_reason=None,
        source_url=SOURCE_URL,
    )
    result = evaluate_prerequisite_completion(1501215, evidence, [], 202601)
    assert result.status == "UNRESOLVED"

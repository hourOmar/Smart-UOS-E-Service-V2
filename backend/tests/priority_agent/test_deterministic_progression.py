from app.agents.raise_capacity_priority.deterministic.progression import build_progression_evidence
from app.agents.raise_capacity_priority.schemas.uos import DependentCourse, SubsequentCourseImpactEvidence

SOURCE_URL = "https://www.sharjah.ac.ae/en/Academics/Degree/Undergraduate/Computer-Science"


def _dependent(course_id, category, always_required, year=None, semester=None):
    return DependentCourse(
        course_id=course_id,
        course_name=f"Course {course_id}",
        category=category,
        specific_course_mandatory=category in ("MANDATORY", "MANDATORY_CORE"),
        always_required=always_required,
        study_plan_year=year,
        study_plan_semester=semester,
    )


# 42. No dependent courses
def test_no_dependent_courses():
    impact = SubsequentCourseImpactEvidence(
        requested_course_id=1501215,
        dependent_courses=[],
        dependent_mandatory_or_core_count=0,
        dependent_elective_count=0,
        source_url=SOURCE_URL,
    )
    evidence = build_progression_evidence(impact)
    assert evidence.total_dependent_courses == 0
    assert evidence.mandatory_or_core_dependent_count == 0
    assert evidence.elective_dependent_count == 0
    assert evidence.dependent_courses == []


# 43. Mandatory/core dependencies
def test_mandatory_core_dependencies():
    dep = _dependent(1501263, "MANDATORY_CORE", always_required=True, year=3, semester=1)
    impact = SubsequentCourseImpactEvidence(
        requested_course_id=1501215,
        dependent_courses=[dep],
        dependent_mandatory_or_core_count=1,
        dependent_elective_count=0,
        source_url=SOURCE_URL,
    )
    evidence = build_progression_evidence(impact)
    assert evidence.mandatory_or_core_dependent_count == 1
    assert evidence.dependent_courses[0].found_in_offerings_kb is True
    assert evidence.dependent_courses[0].category == "MANDATORY_CORE"
    assert evidence.dependent_courses[0].specific_course_mandatory is True


# 44. Elective dependencies
def test_elective_dependencies():
    dep = _dependent(1501341, "ELECTIVE", always_required=True)
    impact = SubsequentCourseImpactEvidence(
        requested_course_id=1501116,
        dependent_courses=[dep],
        dependent_mandatory_or_core_count=0,
        dependent_elective_count=1,
        source_url=SOURCE_URL,
    )
    evidence = build_progression_evidence(impact)
    assert evidence.elective_dependent_count == 1
    assert evidence.dependent_courses[0].category == "ELECTIVE"
    assert evidence.dependent_courses[0].specific_course_mandatory is False


# 45. OR-alternative dependency
def test_or_alternative_dependency():
    dep = _dependent(1501445, "ELECTIVE", always_required=False)
    impact = SubsequentCourseImpactEvidence(
        requested_course_id=1501211,
        dependent_courses=[dep],
        dependent_mandatory_or_core_count=0,
        dependent_elective_count=1,
        source_url=SOURCE_URL,
    )
    evidence = build_progression_evidence(impact)
    assert evidence.or_alternative_dependent_count == 1
    assert evidence.always_required_dependent_count == 0
    assert evidence.dependent_courses[0].always_required is False


# 46. Dependent course missing from offerings KB
def test_dependent_course_missing_from_offerings_kb():
    dep = _dependent(9999999, "MANDATORY_CORE", always_required=True)
    impact = SubsequentCourseImpactEvidence(
        requested_course_id=1501215,
        dependent_courses=[dep],
        dependent_mandatory_or_core_count=1,
        dependent_elective_count=0,
        source_url=SOURCE_URL,
    )
    evidence = build_progression_evidence(impact)
    assert evidence.dependent_courses_missing_from_offerings_kb == 1
    entry = evidence.dependent_courses[0]
    assert entry.found_in_offerings_kb is False
    assert entry.fall is None
    assert entry.spring is None
    assert entry.summer is None
    # UoS-derived dependency information is still preserved, not deleted.
    assert entry.course_id == 9999999
    assert entry.category == "MANDATORY_CORE"


# 47. Mixed dependencies
def test_mixed_dependencies():
    deps = [
        _dependent(1501263, "MANDATORY_CORE", always_required=True),
        _dependent(1501445, "ELECTIVE", always_required=False),
        _dependent(9999999, "ELECTIVE", always_required=True),
    ]
    impact = SubsequentCourseImpactEvidence(
        requested_course_id=1501215,
        dependent_courses=deps,
        dependent_mandatory_or_core_count=1,
        dependent_elective_count=2,
        source_url=SOURCE_URL,
    )
    evidence = build_progression_evidence(impact)
    assert evidence.total_dependent_courses == 3
    assert evidence.mandatory_or_core_dependent_count == 1
    assert evidence.elective_dependent_count == 2
    assert evidence.always_required_dependent_count == 2
    assert evidence.or_alternative_dependent_count == 1
    assert evidence.dependent_courses_missing_from_offerings_kb == 1

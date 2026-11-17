"""Scoring and quote verification, ported from the standalone tests (test_agent.py scoring
section and test_match_verifier.py)."""

from app.agents.course_equivalency import similarity
from app.agents.course_equivalency.eligibility import _apply_guardrails
from app.agents.course_equivalency.match_verifier import _norm, quote_in_text, verify_matches
from app.agents.course_equivalency.policy import classify_grade, load_equivalency_policy, meets_minimum_grade
from app.agents.course_equivalency.similarity import compute_similarity

from .fakes import make_analysis as _analysis

OLD = "Week 1: Propositional logic, logical operators.\nWeek 2: Sets and\nOperations; functions.\nWeek 3: Basic counting techniques."
NEW = "Topics: Fundamentals of logic and truth tables. Sets, functions. Graph theory: paths, Euler and Hamilton graphs."


def _qanalysis(matches):
    return {"old": {"title": "O", "credit_hours": 3, "topics": ["logic", "sets", "counting"], "learning_outcomes": ["o"], "assessment": {}},
            "new": {"title": "N", "credit_hours": 3, "topics": ["logic", "sets", "graphs"], "learning_outcomes": ["o"], "assessment": {}},
            "topic_matches": matches, "outcome_matches": []}


def test_grade_policy():
    assert classify_grade("B+") is True
    assert classify_grade("F") is False
    assert classify_grade(None) is False
    assert classify_grade("Z") is None


def test_minimum_grade_is_c_plus():
    assert [meets_minimum_grade(g) for g in ("A", "B", "C+", "C", "D", "F", None, "Z")] == [True, True, True, False, False, False, None, None]


def test_policy_loads_with_80_60():
    t = load_equivalency_policy()["similarity_thresholds"]
    assert (t["equivalent_min"], t["review_min"]) == (80, 60)


def test_identical_courses_score_100_and_equivalent_band():
    s = compute_similarity(_analysis(), 3, 3, load_equivalency_policy())
    assert s["overall_similarity_percent"] == 100.0
    assert s["score_band"] == "EQUIVALENT_RANGE"
    assert s["new_topics_not_covered"] == []


def test_uncovered_topics_are_listed_and_lower_the_score():
    s = compute_similarity(_analysis(n_new=4, full=2, out_full=0), 3, 3, load_equivalency_policy())
    assert s["new_topics_not_covered"] == ["t2", "t3"]
    assert s["components_percent"]["topics"] == 50.0
    assert s["score_band"] == "BELOW_RANGE"


def test_partial_matches_count_half():
    s = compute_similarity(_analysis(n_new=2, full=1, partial=1), 3, 3, load_equivalency_policy())
    assert s["components_percent"]["topics"] == 75.0


def test_invalid_match_indexes_are_ignored():
    a = _analysis(n_new=2, full=0)
    a["topic_matches"] = [{"new_index": 9, "old_index": 0, "strength": "full"}, {"new_index": -1, "old_index": 0, "strength": "full"}]
    assert compute_similarity(a, 3, 3, load_equivalency_policy())["components_percent"]["topics"] == 0.0


def test_credit_hours_old_lower_than_new():
    s = compute_similarity(_analysis(), 2, 3, load_equivalency_policy())
    assert s["credit_hours"]["old_covers_new"] is False
    assert s["components_percent"]["credit_hours"] == 66.7


def test_credit_mismatch_between_catalog_and_syllabus_is_noted():
    s = compute_similarity(_analysis(), 4, 3, load_equivalency_policy())
    assert "catalog says 4" in s["credit_hours"]["note"]


def test_assessment_similarity():
    s = compute_similarity(_analysis(old_assess={"exams": 100}, new_assess={"projects": 100}), 3, 3, load_equivalency_policy())
    assert s["components_percent"]["assessment_structure"] == 0.0


def test_no_topics_means_no_score():
    assert compute_similarity(_analysis(n_new=0, full=0), 3, 3, load_equivalency_policy())["overall_similarity_percent"] is None


def test_text_overlap_baseline():
    assert similarity.text_overlap_percent("java arrays loops", "java arrays loops") == 100.0
    assert similarity.text_overlap_percent("java arrays", "sql joins") == 0.0


def test_syllabus_request_names_the_accepted_formats():
    s = {"old": {"readable": True}, "new": {"readable": False}}
    msg = similarity.syllabus_request_message(s)
    assert "requested course" in msg and "previously completed" not in msg and "PDF or DOCX" in msg and "TXT" not in msg
    assert similarity.syllabus_request_message({"old": {"readable": True}, "new": {"readable": True}}) is None


def test_quote_found_even_across_line_breaks_and_punctuation():
    assert quote_in_text("Sets and Operations; functions.", _norm(OLD))
    assert not quote_in_text("Graph theory and trees", _norm(OLD))


def test_short_or_empty_quotes_are_not_accepted():
    assert not quote_in_text("sets", _norm(OLD))
    assert not quote_in_text("", _norm(OLD))


def test_invented_match_is_dropped_and_real_one_kept():
    good = {"new_index": 0, "old_index": 0, "strength": "full", "old_quote": "Propositional logic, logical operators", "new_quote": "Fundamentals of logic and truth tables"}
    fake = {"new_index": 2, "old_index": 2, "strength": "full", "old_quote": "Graph theory including Euler and Hamilton paths", "new_quote": "Graph theory: paths, Euler and Hamilton graphs"}
    out = verify_matches(_qanalysis([good, fake]), OLD, NEW)
    assert [m["new_index"] for m in out["topic_matches"]] == [0]
    v = out["verification"]
    assert v["claimed_total"] == 2 and v["dropped_total"] == 1 and v["dropped_percent"] == 50.0


def test_invented_match_cannot_raise_the_score():
    fake = {"new_index": 2, "old_index": 2, "strength": "full", "old_quote": "Graph theory including Euler and Hamilton paths", "new_quote": "Graph theory: paths"}
    sim = compute_similarity(verify_matches(_qanalysis([fake]), OLD, NEW), 3, 3, load_equivalency_policy())
    assert sim["components_percent"]["topics"] == 0.0 and sim["verification_ok"] is False


def test_approval_is_withheld_when_many_matches_are_unverified():
    ev = {"constraints": {"minimum_grade": {"meets": True, "grade": "A", "required": "C+"}, "study_plan": {"in_plan": True},
                          "credit_hours": {"old_covers_new": True, "old": 3, "new": 3},
                          "transfer_limit": {"within_limit": True}},
          "similarity": {"score_band": "EQUIVALENT_RANGE", "verification_ok": False}}
    out = _apply_guardrails(ev, {"status": "ok", "error": None, "recommendation": "APPROVE", "reasoning": "Looks equivalent."})
    assert out["recommendation"] == "MANUAL_REVIEW" and "could not be confirmed" in out["reasoning"]
    ev["similarity"]["verification_ok"] = True
    out = _apply_guardrails(ev, {"status": "ok", "error": None, "recommendation": "APPROVE", "reasoning": "Looks equivalent."})
    assert out["recommendation"] == "APPROVE"

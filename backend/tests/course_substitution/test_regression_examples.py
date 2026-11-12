"""The contract's regression examples (section 10), run through pipeline.run_pipeline
with the real data files, a fake database, a frozen Dubai date and a fake Gemini."""

import datetime as dt
import json

from app.agents.course_substitution_eligibility.pipeline import run_pipeline
from app.agents.course_substitution_eligibility.rejection_agent import explain_rejection_workflow

from .fakes import (
    COMPUTER_ARCHITECTURE, ETHICS, INFO_SECURITY, OOD_JAVA, PROGRAMMING_I, REQUEST_ID, STUDY_PLAN_URL, api_error,
    db_rows, freeze_today, install_fake_database, install_fake_gemini, load_vocabulary, study_plan_reply,
)

MATCH = "Matched catalog program: Bachelor of Science in Computer Science"
FALLBACK_NOTE = ("Gemini suggestions were unavailable or did not pass validation. "
                 "These explanations were generated from verified rejection reasons.")


def run(monkeypatch, day, rows, *gemini):
    freeze_today(monkeypatch, day)
    install_fake_database(monkeypatch, rows)
    models = install_fake_gemini(monkeypatch, *gemini)
    return run_pipeline(REQUEST_ID), models


def rows_of(result):
    return [(c["status"], c["evidence"]) for c in result["eligibility_result"]["checks"]]


# --- Example A ------------------------------------------------------------------

def example_a(monkeypatch, graduation=202601, *gemini):
    return run(monkeypatch, dt.date(2026, 11, 11),
               db_rows(original=OOD_JAVA, proposed=INFO_SECURITY, graduation=graduation),
               *(gemini or (study_plan_reply(),)))


def test_example_a_eligible(monkeypatch):
    out, models = example_a(monkeypatch)
    eligibility = out["eligibility_result"]
    assert eligibility["overall_result"] == "ELIGIBLE"
    assert (eligibility["current_term"], eligibility["current_semester"]) == (202601, "Fall")
    assert rows_of(out) == [
        ("PASS", "Object Oriented Design with Java is not offered in any remaining semester through graduation. "
                 "Checked: Fall (202601): NO."),
        ("PASS", "Original year/level: 2/46; proposed year/level: 4/59."),
        ("PASS", f"{MATCH}. Listed under Major Compulsory Courses."),
        ("PASS", "Information Security is listed as offered in Fall."),
        ("PASS", "Course 1501459 has not been completed with a passing grade."),
    ]
    assert eligibility["checks"][2]["classification"] == "COMPULSORY"
    assert eligibility["checks"][2]["source_url"] == STUDY_PLAN_URL
    assert out["rejection_result"]["status"] == "not_applicable"
    (call,) = models.calls
    assert call["config"].tools[0].url_context is not None


def test_example_a_graduation_term_stored_as_text(monkeypatch):
    out, _ = example_a(monkeypatch, "202601")
    assert out["eligibility_result"]["overall_result"] == "ELIGIBLE"
    assert rows_of(out)[0][1].endswith("Checked: Fall (202601): NO.")


def test_example_a_gemini_failure_gives_manual_review(monkeypatch):
    out, _ = example_a(monkeypatch, 202601, api_error(503))
    assert out["eligibility_result"]["overall_result"] == "MANUAL_REVIEW"
    assert rows_of(out)[2][0] == "REQUIRES_REVIEW"
    assert rows_of(out)[2][1].startswith("Could not verify the official study plan with Gemini: ")


# --- Example B ------------------------------------------------------------------

def test_example_b_rejection_fixture_fallback(monkeypatch):
    models = install_fake_gemini(monkeypatch, api_error(503))
    fixture = {"overall_result": "NOT_ELIGIBLE", "checks": [
        {"condition": "Proposed course is at the same level or higher", "status": "FAIL",
         "evidence": "Original level: 72. Proposed level: 42."}]}
    out = explain_rejection_workflow(fixture)
    entry = load_vocabulary()["proposed_course_lower_level"]
    assert out["deterministic_keywords"] == [{"keyword": "proposed_course_lower_level", "label": entry["label"],
                                              "policy_basis": entry["policy_basis"],
                                              "plain_reason": entry["plain_reason"]}]
    assert out["status"] == "fallback" and out["judgment_keywords"] == [] and out["conflict_note"] == ""
    reason = ("The proposed replacement course is at a lower academic level than the original course. "
              "A replacement must be at the same level or a higher level.")
    assert out["suggested_reasons"] == [
        {"tone": "formal", "text": f"Your Course Substitution request cannot be approved for the following reason(s): {reason}",
         "addresses_keywords": ["proposed_course_lower_level"]},
        {"tone": "concise", "text": reason, "addresses_keywords": ["proposed_course_lower_level"]},
        {"tone": "supportive", "text": "Unfortunately, your proposed course substitution does not meet the "
                                       f"eligibility requirements. {reason}",
         "addresses_keywords": ["proposed_course_lower_level"]},
    ]
    assert out["fallback_note"] == FALLBACK_NOTE
    assert out["gemini_error"].startswith("GeminiUnavailableError: Gemini request failed: ServerError 503")
    (call,) = models.calls
    assert call["config"] is None


# --- Example C ------------------------------------------------------------------

def test_example_c_spring_summer_fall_walk_not_eligible(monkeypatch):
    out, models = run(monkeypatch, dt.date(2027, 2, 10),
                      db_rows(original=ETHICS, proposed=PROGRAMMING_I, graduation=202701, completed=[PROGRAMMING_I[0]]),
                      api_error(503), api_error(503))        # study plan call, then rejection call
    eligibility = out["eligibility_result"]
    assert eligibility["overall_result"] == "NOT_ELIGIBLE"
    assert (eligibility["current_term"], eligibility["current_semester"]) == (202602, "Spring")
    statuses, evidence = zip(*rows_of(out))
    assert statuses == ("FAIL", "FAIL", "REQUIRES_REVIEW", "PASS", "FAIL")
    assert evidence[0] == ("Professional, Social and Ethical Issues in CS is offered in a remaining Fall semester. "
                           "Checked: Spring (202602): NO, Summer after 202602: NO, Fall (202701): YES.")
    assert evidence[1] == ("Original year/level: 3/22; proposed year/level: 1/16. "
                           "The proposed course is lower under the defined rule.")
    assert evidence[2].startswith("Could not verify the official study plan with Gemini: ")
    assert evidence[3] == "Programming I is listed as offered in Spring."
    assert evidence[4] == "Course 1501116 has previously been completed with a passing grade."

    rejection = out["rejection_result"]
    keywords = ["original_course_offered_before_graduation", "proposed_course_lower_level",
                "proposed_course_already_completed"]
    assert [k["keyword"] for k in rejection["deterministic_keywords"]] == keywords
    vocabulary = load_vocabulary()
    concise = next(r for r in rejection["suggested_reasons"] if r["tone"] == "concise")
    assert concise["text"] == " ".join(vocabulary[k]["plain_reason"] for k in keywords)
    assert rejection["status"] == "fallback"
    assert [c["config"] is not None for c in models.calls] == [True, False]


# --- Example D ------------------------------------------------------------------

def test_example_d1_no_current_term_in_june(monkeypatch):
    out, _ = run(monkeypatch, dt.date(2026, 6, 15),
                 db_rows(original=OOD_JAVA, proposed=INFO_SECURITY, graduation=202602), study_plan_reply())
    eligibility = out["eligibility_result"]
    assert (eligibility["current_term"], eligibility["current_semester"]) == (None, None)
    assert out["request"]["current_term"] is None
    assert [s for s, _ in rows_of(out)] == ["REQUIRES_REVIEW", "PASS", "PASS", "REQUIRES_REVIEW", "PASS"]
    assert rows_of(out)[0][1] == "The current academic term could not be determined."
    assert rows_of(out)[3][1] == "The current Fall/Spring semester could not be determined."
    assert eligibility["overall_result"] == "MANUAL_REVIEW"
    assert out["rejection_result"]["status"] == "not_applicable"


def test_summer_date_with_a_failing_term_independent_check_is_not_eligible(monkeypatch):
    """Contract section 3: outside August-May a FAIL in check 2, 3 or 5 still wins."""
    rejection = {"judgment_keywords": [], "conflict_note": "", "suggested_reasons": []}   # invalid -> fallback
    out, _ = run(monkeypatch, dt.date(2026, 7, 20),
                 db_rows(original=OOD_JAVA, proposed=PROGRAMMING_I, graduation=202602),
                 study_plan_reply(), json.dumps(rejection))
    eligibility = out["eligibility_result"]
    assert eligibility["current_term"] is None
    assert [s for s, _ in rows_of(out)] == ["REQUIRES_REVIEW", "FAIL", "PASS", "REQUIRES_REVIEW", "PASS"]
    assert eligibility["overall_result"] == "NOT_ELIGIBLE"
    assert [k["keyword"] for k in out["rejection_result"]["deterministic_keywords"]] == ["proposed_course_lower_level"]


def test_example_d2_unknown_offering(monkeypatch):
    out, _ = run(monkeypatch, dt.date(2026, 11, 11),
                 db_rows(original=COMPUTER_ARCHITECTURE, proposed=INFO_SECURITY, graduation=202602),
                 study_plan_reply())
    assert rows_of(out)[0] == ("REQUIRES_REVIEW", "The offering status for Computer Architecture is unknown in Fall. "
                                                  "Checked: Fall (202601): UNKNOWN.")
    assert out["eligibility_result"]["overall_result"] == "MANUAL_REVIEW"

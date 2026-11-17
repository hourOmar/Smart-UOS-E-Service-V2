"""The eligibility workflow with every external call faked, ported from the standalone
test_agent.py (evaluation workflow, university constraints, program changes), plus the
approved Phase 4 changes: best attempt, Gemini failures raise, Gemini input without identity."""

import pytest

from app.agents.course_equivalency import eligibility
from app.agents.course_equivalency.rejection import verified_facts
from app.core.gemini import GeminiUnavailableError

from .fakes import REASON, RID, STUDENT_ID, STUDENT_NAME, decision, make_analysis, make_data, patch_gemini, sides


def run(monkeypatch, data=None, syl=None, analysis=None, result=None, **kw):
    patch_gemini(monkeypatch, analysis=analysis, result=result)
    return eligibility.evaluate_course_equivalency_request(RID, data or make_data(**kw), syl or sides())


def test_equivalent_request_is_approved(monkeypatch):
    r = run(monkeypatch)
    assert r["recommendation"] == "APPROVE" and r["equivalency_label"] == "EQUIVALENT"
    assert r["evidence"]["similarity"]["overall_similarity_percent"] == 100.0


def test_failing_grade_forces_reject_even_if_gemini_approves(monkeypatch):
    assert run(monkeypatch, grade="F")["recommendation"] == "REJECT"


def test_approve_downgraded_when_score_not_in_equivalent_range(monkeypatch):
    assert run(monkeypatch, analysis=make_analysis(n_new=4, full=2, out_full=1))["recommendation"] == "MANUAL_REVIEW"


def test_approve_downgraded_when_course_not_in_transcript(monkeypatch):
    assert run(monkeypatch, grade="none")["recommendation"] == "MANUAL_REVIEW"


def test_unreadable_syllabus_asks_for_upload_and_never_approves(monkeypatch):
    seen = patch_gemini(monkeypatch)
    r = eligibility.evaluate_course_equivalency_request(RID, make_data(), sides(new_readable=False))
    assert r["recommendation"] == "MANUAL_REVIEW" and "Upload a readable syllabus" in r["syllabus_request"]
    assert r["evidence"]["similarity"] is None and seen["analysis"] == []      # no analysis without both texts


def test_gemini_failures_raise_instead_of_manual_review(monkeypatch):
    patch_gemini(monkeypatch, analysis_error=GeminiUnavailableError("Gemini request failed: 503"))
    with pytest.raises(GeminiUnavailableError):
        eligibility.evaluate_course_equivalency_request(RID, make_data(), sides())
    patch_gemini(monkeypatch, decision_error=GeminiUnavailableError("Gemini request failed: 429"))
    with pytest.raises(GeminiUnavailableError):
        eligibility.evaluate_course_equivalency_request(RID, make_data(), sides())


def test_grade_c_is_passing_but_below_minimum_so_rejected(monkeypatch):
    r = run(monkeypatch, grade="C")
    assert r["recommendation"] == "REJECT" and "below the required minimum of C+" in r["reasoning"]


def test_course_not_in_study_plan_is_rejected(monkeypatch):
    r = run(monkeypatch, in_plan=False)
    assert r["recommendation"] == "REJECT" and "study plan" in r["reasoning"]


def test_old_course_with_fewer_credit_hours_is_rejected(monkeypatch):
    assert run(monkeypatch, old_credit=2, new_credit=3)["recommendation"] == "REJECT"


def test_equal_or_greater_credit_hours_pass(monkeypatch):
    assert run(monkeypatch, old_credit=4, new_credit=3)["recommendation"] == "APPROVE"


def test_transfer_limit_60_default_and_70_for_engineering(monkeypatch):
    assert run(monkeypatch, transferred=58, new_credit=3)["recommendation"] == "REJECT"
    assert run(monkeypatch, transferred=58, new_credit=3, college="College of Engineering")["recommendation"] == "APPROVE"


def test_half_of_study_plan_limit(monkeypatch):
    r = run(monkeypatch, transferred=45, new_credit=3, plan_total=90)
    assert r["recommendation"] == "REJECT"
    assert r["evidence"]["constraints"]["transfer_limit"]["cap_credit_hours"] == 45


def test_cpe_in_computing_college_keeps_the_60_limit_and_half_of_132(monkeypatch):
    """Approved decision 4: the college-name rule unchanged -- Computer Engineering belongs to the
    College of Computing and Informatics, so the cap is min(60, 66) = 60."""
    r = run(monkeypatch, college="College of Computing and Informatics", plan_total=132)
    tl = r["evidence"]["constraints"]["transfer_limit"]
    assert tl["cap_credit_hours"] == 60
    r = run(monkeypatch, college="College of Computing and Informatics", plan_total=123)
    assert r["evidence"]["constraints"]["transfer_limit"]["cap_credit_hours"] == 60


def test_unverified_study_plan_blocks_approval(monkeypatch):
    assert run(monkeypatch, in_plan=None)["recommendation"] == "MANUAL_REVIEW"


def test_approval_note_mentions_tr_and_cgpa(monkeypatch):
    r = run(monkeypatch)
    assert "TR" in r["approval_note"] and "CGPA" in r["approval_note"]


def _plans(**by_name):
    return dict(by_name)


def test_approved_program_change_uses_the_new_programs_plan(monkeypatch):
    change = {"completed": {"new_program_id": 9, "new_program_name": "Computer Engineering",
                            "current_program_name": "Computer Science", "status": "Completed"}, "pending": None}
    r = run(monkeypatch, program_change=change, plans={"Computer Engineering": {"1501116"}})
    sp = r["evidence"]["constraints"]["study_plan"]
    assert sp["in_plan"] is True and sp["program_checked"] == "Computer Engineering" and r["recommendation"] == "APPROVE"


def test_course_in_old_program_only_is_rejected_after_the_change(monkeypatch):
    change = {"completed": {"new_program_id": 9, "new_program_name": "Computer Engineering",
                            "current_program_name": "Computer Science", "status": "Completed"}, "pending": None}
    r = run(monkeypatch, program_change=change, plans={"Computer Science": {"1501116"}, "Computer Engineering": set()})
    assert r["recommendation"] == "REJECT"


def test_pending_program_change_sends_the_request_to_manual_review(monkeypatch):
    change = {"completed": None, "pending": {"new_program_id": 9, "new_program_name": "Computer Engineering",
                                            "current_program_name": "Computer Science", "status": "In Progress"}}
    r = run(monkeypatch, program_change=change, plans={"Computer Science": set(), "Computer Engineering": {"1501116"}})
    sp = r["evidence"]["constraints"]["study_plan"]
    assert sp["in_plan"] is None and "not been approved" in sp["note"] and r["recommendation"] == "MANUAL_REVIEW"


def test_rejected_program_change_rejects_with_its_own_reason(monkeypatch):
    change = {"completed": None, "pending": None,
              "rejected": {"new_program_id": 9, "new_program_name": "Computer Engineering",
                           "current_program_name": "Computer Science", "status": "Rejected"}}
    r = run(monkeypatch, program_change=change, plans={"Computer Science": set(), "Computer Engineering": {"1501116"}})
    sp = r["evidence"]["constraints"]["study_plan"]
    assert r["recommendation"] == "REJECT" and sp["program_change"]["result"] == "rejected" and "was rejected" in sp["note"]
    assert "program_change_rejected" in verified_facts(r)


def test_unrelated_pending_change_is_not_attached(monkeypatch):
    change = {"completed": None, "rejected": None,
              "pending": {"new_program_id": 5, "new_program_name": "Artificial Intelligence",
                          "current_program_name": "Computer Science", "status": "In Progress"}}
    r = run(monkeypatch, program_change=change, plans={"Computer Science": set(), "Artificial Intelligence": set()})
    sp = r["evidence"]["constraints"]["study_plan"]
    assert sp["in_plan"] is False and sp["program_change"] is None


def test_best_attempt_is_used_for_retaken_courses(monkeypatch):
    """Approved decision 6: the best attempt (Phase 2A order), not the first row."""
    transcript = [{"Course_ID": "1501110", "Section_ID": "11", "Term": 202410, "Grade": "C"},
                  {"Course_ID": "1501110", "Section_ID": "12", "Term": 202510, "Grade": "B+"},
                  {"Course_ID": "1501110", "Section_ID": "13", "Term": 202610, "Grade": None}]
    r = run(monkeypatch, transcript=transcript)
    old = r["evidence"]["old_course"]
    assert old["grade"] == "B+" and old["term"] == 202510 and r["recommendation"] == "APPROVE"


def test_gemini_never_receives_identity_reason_cgpa_or_file_names(monkeypatch):
    seen = patch_gemini(monkeypatch)
    eligibility.evaluate_course_equivalency_request(RID, make_data(), sides())
    sent = repr(seen["decision"][0])
    for value in (STUDENT_NAME, STUDENT_ID, REASON, "STUD_CPSR_CHP3_900002", "3.1", "'completed_hours'", "'cgpa'",
                  "'student_id'", "syllabus-"):
        assert value not in sent, value
    assert seen["decision"][0]["student"] == {"program_id": "1501", "program_name": "Computer Science"}
    # the stored evidence still has them for staff
    r = run(monkeypatch)
    assert r["evidence"]["student"]["name"] == STUDENT_NAME and r["evidence"]["request"]["reason"] == REASON


def test_syllabus_analysis_receives_the_two_texts_only(monkeypatch):
    seen = patch_gemini(monkeypatch)
    eligibility.evaluate_course_equivalency_request(RID, make_data(), sides(old_text="OLD BODY " * 10, new_text="NEW BODY " * 10))
    assert seen["analysis"] == [("OLD BODY " * 10, "NEW BODY " * 10)]


def test_rejected_result_shape(monkeypatch):
    r = run(monkeypatch, result=decision("REJECT", "Low similarity."), analysis=make_analysis(n_new=4, full=1, out_full=0))
    assert r["recommendation"] == "REJECT" and r["equivalency_label"] == "NON_EQUIVALENT" and r["approval_note"] is None
    assert r["models"] == {"decision": "model-decision"}

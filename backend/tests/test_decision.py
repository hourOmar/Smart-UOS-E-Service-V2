from app.agents.raise_capacity_eligibility import decision
from app.agents.raise_capacity_eligibility.schemas import CheckExplanations, EligibilityDecision
from app.core import gemini

EVIDENCE = {
    "request_id": "STUD_RSCA_RSCA_000001",
    "student": {"Student_ID": "U21100001", "Student_Name": "Zaynab Distinctname"},
    "course": {"Course_ID": "1501279", "Course_Name": "Data Structures"},
    "section_id": "1",
    "term": 202601,
    "checks": {"prerequisite": {"verified": True}, "completed_hours": {}, "capacity": {}},
}


def test_prompt_keeps_the_student_identity_out():
    prompt = decision.build_prompt(EVIDENCE)
    assert "Distinctname" not in prompt
    assert "U21100001" not in prompt
    assert "STUD_RSCA_RSCA_000001" in prompt
    assert EVIDENCE["student"]["Student_Name"] == "Zaynab Distinctname"  # stored evidence unchanged


def test_prompt_states_the_rules_including_unrecorded_hours_and_source_scope():
    prompt = decision.build_prompt(EVIDENCE)
    assert "REJECT requires a CONFIRMED, verified failure" in prompt
    assert "checks.completed_hours.satisfied is null" in prompt
    assert "only Computer Science degree-page" in prompt


def test_gemini_decision(monkeypatch):
    def fake(prompt, schema, *, model=None, context=""):
        assert schema is EligibilityDecision
        return EligibilityDecision(
            recommendation="APPROVE",
            reasoning="All checks satisfied.",
            checks=CheckExplanations(prerequisite="ok", completed_hours="n/a", capacity="space"),
        )

    monkeypatch.setattr(decision, "generate_structured", fake)
    result = decision.get_decision(EVIDENCE)
    assert result["status"] == "ok"
    assert result["recommendation"] == "APPROVE"
    assert result["model"] == "test-model"


def test_gemini_unavailable_is_manual_review_without_a_guess():
    # No GEMINI_API_KEY in the test environment: the real client path reports unavailable.
    gemini._client = None
    result = decision.get_decision(EVIDENCE)
    assert result["status"] == "unavailable"
    assert result["recommendation"] == "MANUAL_REVIEW"
    assert "GEMINI_API_KEY" in result["error"]

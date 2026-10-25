"""The whole Program Change agent, request ID in, result out: Shaikha's flow,
prompt and recommendation parsing, through the real llm_client and
app.core.gemini with a fake Gemini client and a fake request reader.
Also guards that the package never uses Supabase or an RPC."""

import ast
import hashlib
from pathlib import Path

import pytest

from app.agents.program_change_eligibility import eligibility_agent, eligibility_checks, evidence, llm_client
from app.core import gemini
from app.core.gemini import GeminiUnavailableError

from .fakes import (
    PLAN_COURSES, STUDY_PLAN_REPLY, FakeTextModels, approve_transcript, client_error, program_change_request,
    report, server_error,
)

PACKAGE_DIR = Path(eligibility_agent.__file__).resolve().parent


@pytest.fixture
def agent(monkeypatch):
    """Installs a fake request reader and fake Gemini replies; returns the
    Gemini call log and the number of request reads."""
    def install(request, *replies):
        reads = []

        def read(request_id):
            reads.append(request_id)
            return request

        monkeypatch.setattr(eligibility_agent, "get_program_change_request", read)
        monkeypatch.setattr(evidence, "get_program_change_request", read)
        models = FakeTextModels(replies)
        monkeypatch.setattr(gemini, "get_client", lambda: type("Client", (), {"models": models})())
        return models, reads
    return install


# -- recommendation parsing ---------------------------------------------------------

@pytest.mark.parametrize("recommendation", ["APPROVE", "REJECT", "REQUIRES_REVIEW"])
def test_extract_recommendation(recommendation):
    assert eligibility_agent.extract_recommendation(report(recommendation)) == recommendation


@pytest.mark.parametrize("line, expected", [
    # Labeled line
    ("Recommendation: APPROVE", "APPROVE"),
    ("Recommendation: REJECT", "REJECT"),
    ("Recommendation:REQUIRES_REVIEW", "REQUIRES_REVIEW"),
    ("**Recommendation:** APPROVE", "APPROVE"),
    ("**Recommendation: REJECT**", "REJECT"),
    ("Recommendation: **REQUIRES_REVIEW**", "REQUIRES_REVIEW"),
    ("## Recommendation: APPROVE", "APPROVE"),
    ("RECOMMENDATION: reject.", "REJECT"),
    ("- Recommendation: APPROVE", "APPROVE"),
    # A line stating only the recommendation
    ("**APPROVE**", "APPROVE"),
    ("__REJECT__", "REJECT"),
    ("`REQUIRES_REVIEW`", "REQUIRES_REVIEW"),
    ("APPROVE.", "APPROVE"),
    ("- APPROVE", "APPROVE"),
    ("* REJECT", "REJECT"),
    ("• REJECT", "REJECT"),
    ("## APPROVE", "APPROVE"),
    ("> APPROVE", "APPROVE"),
    ("approve", "APPROVE"),
    ("Reject", "REJECT"),
    ("requires_review", "REQUIRES_REVIEW"),
    ("REQUIRES REVIEW", "REQUIRES_REVIEW"),
    ("requires review.", "REQUIRES_REVIEW"),
    ("**Requires Review**", "REQUIRES_REVIEW"),
    ("  REJECT  ", "REJECT"),
])
def test_formatting_variations_are_accepted(line, expected):
    assert eligibility_agent.extract_recommendation(f"Overall Assessment:\nSynthetic.\n\n{line}\n") == expected


@pytest.mark.parametrize("heading", ["Recommendation:", "**Recommendation:**", "## Recommendation", "RECOMMENDATION"])
def test_value_under_a_recommendation_heading(heading):
    text = f"Overall Assessment:\nSynthetic.\n\n{heading}\n\n**REJECT**\n"
    assert eligibility_agent.extract_recommendation(text) == "REJECT"


def test_the_standalone_final_line_format_still_works():
    assert eligibility_agent.extract_recommendation("Report text.\nSomething else.\nAPPROVE") == "APPROVE"


def test_the_same_recommendation_stated_twice_is_accepted():
    text = "Recommendation: REJECT\n\nRecommendation:\nREJECT\n"
    assert eligibility_agent.extract_recommendation(text) == "REJECT"


@pytest.mark.parametrize("text", [
    "APPROVE\nOverall Assessment:\nSomething.\nRecommendation:\n  REJECT  \n",   # earlier "last line wins"
    "Recommendation: APPROVE\n\nREJECT",
    "Recommendation:\nREQUIRES_REVIEW\n\nRecommendation: approve",
    "**APPROVE**\n**REQUIRES REVIEW**",
])
def test_contradictory_recommendations_fail_clearly(text):
    with pytest.raises(ValueError, match="contradictory recommendations"):
        eligibility_agent.extract_recommendation(text)


@pytest.mark.parametrize("text", [
    "Recommendation: APPROVE or REJECT",
    "Recommendation: MANUAL_REVIEW",
    "Recommendation: Approve the request",
    "Recommendation: APPROVED",
    "Recommendation: N/A",
])
def test_an_unsupported_labeled_value_fails(text):
    with pytest.raises(ValueError, match="unsupported recommendation value"):
        eligibility_agent.extract_recommendation(text)


@pytest.mark.parametrize("text", [
    "",
    "   \n\n",
    "APPROVE or REJECT",
    "MANUAL_REVIEW",
    "MANUAL REVIEW",
    "Recommendation:",
    "Recommendation:\n\nThe student should be approved because the CGPA is high.",
    "I recommend that you APPROVE this request.",
    "Overall Assessment:\nThe evidence supports approval.",
    "APPROVE_REQUEST",
    "REQUIRES-REVIEW",
])
def test_no_recommendation_is_inferred_from_prose_or_unsupported_values(text):
    with pytest.raises(ValueError, match="does not contain a valid recommendation"):
        eligibility_agent.extract_recommendation(text)


def test_other_report_lines_are_never_read_as_recommendations():
    text = ("CGPA Assessment:\nVerified CGPA: 3.1\nRequirement: 2.0 or above\nStatus: Satisfied\n\n"
            "Issues / Conflicts:\nNone\n\nRecommendation:\nREQUIRES_REVIEW\n")
    assert eligibility_agent.extract_recommendation(text) == "REQUIRES_REVIEW"


# The assessment prompt rendered for fixed synthetic inputs, fingerprinted
# before the parsing change (agent 1.1.0): parsing never touches the prompt.
PROMPT_SHA256 = "e16bb649d5b25f0ab1006ad9087f3c53dcaf44eccec34f0f705be80191472db2"


def test_the_assessment_prompt_text_is_unchanged():
    request = program_change_request(approve_transcript())
    evidence_package = {
        "current_program": {"program_name": "Current P", "program_id": "0101"},
        "requested_program": {"program_name": "Requested P", "program_id": "0201",
                              "study_plan_source": {"courses": PLAN_COURSES}},
        "program_change_constraints": "RULES TEXT",
        "university_courses": "UNIVERSITY TEXT",
    }
    results = eligibility_checks.run_basic_checks(request, PLAN_COURSES)
    prompt = eligibility_agent.build_assessment_prompt(request, evidence_package, results)
    assert hashlib.sha256(prompt.encode()).hexdigest() == PROMPT_SHA256


# -- full run --------------------------------------------------------------------------

def test_full_run(agent):
    request = program_change_request(approve_transcript())
    models, reads = agent(request, STUDY_PLAN_REPLY, report("APPROVE"))

    result = eligibility_agent.run_program_change_agent("STUD_TEST_000001")

    assert result["request_id"] == "STUD_TEST_000001"
    assert result["agent_recommendation"] == "APPROVE"
    assert result["report"] == report("APPROVE").strip()
    assert result["deterministic_results"]["applicable_hours"] == 24
    assert result["deterministic_results"]["cgpa_eligible"] is True
    assert reads == ["STUD_TEST_000001", "STUD_TEST_000001"]   # agent + evidence, as standalone

    study_plan_call, assessment_call = models.calls
    assert study_plan_call["model"] == llm_client.GEMINI_MODELS[0]
    assert study_plan_call["config"].tools[0].url_context is not None
    assert "Open and read this official University of Sharjah webpage" in study_plan_call["contents"]
    assert assessment_call["config"] is None
    prompt = assessment_call["contents"]
    assert "You are the Program Change Eligibility Academic Analyst" in prompt
    assert "- 0201301 — Course 0201301 — 3 credits" in prompt
    assert "Applicable Credit Hours:\n24" in prompt
    assert "PROGRAM CHANGE CONSTRAINTS" in prompt and "UNIVERSITY COURSES" in prompt


def test_full_run_returns_the_structured_eligibility_results(agent):
    agent(program_change_request(approve_transcript()), STUDY_PLAN_REPLY, report("APPROVE"))
    results = eligibility_agent.run_program_change_agent("STUD_TEST_000001")["deterministic_results"]
    assert results["min_cgpa"] == 2.0 and results["min_applicable_hours"] == 15
    assert results["applicable_hours_eligible"] is True


NEW_KEYS = ("min_cgpa", "min_applicable_hours", "applicable_hours_eligible")


def test_the_assessment_prompt_is_unchanged_by_the_structured_results(agent, monkeypatch):
    # The prompt reads only the original keys: the same request gives the same
    # prompt with and without the three new ones.
    request = program_change_request(approve_transcript())
    models, _ = agent(request, STUDY_PLAN_REPLY, report("APPROVE"), STUDY_PLAN_REPLY, report("APPROVE"))
    eligibility_agent.run_program_change_agent("STUD_TEST_000001")

    original = eligibility_agent.run_basic_checks

    def without_new_keys(*args):
        return {k: v for k, v in original(*args).items() if k not in NEW_KEYS}
    monkeypatch.setattr(eligibility_agent, "run_basic_checks", without_new_keys)
    eligibility_agent.run_program_change_agent("STUD_TEST_000001")

    with_keys, without_keys = models.calls[1]["contents"], models.calls[3]["contents"]
    assert with_keys == without_keys
    assert "Requirement: 2.0 or above" in with_keys
    assert "Requirement: At least 15 applicable credit hours" in with_keys
    assert not any(key in with_keys for key in NEW_KEYS)


@pytest.mark.parametrize("cgpa, recommendation", [(1.8, "REJECT"), (3.0, "REQUIRES_REVIEW")])
def test_recommendation_is_the_one_gemini_wrote(agent, cgpa, recommendation):
    agent(program_change_request(approve_transcript(), cgpa=cgpa), STUDY_PLAN_REPLY, report(recommendation))
    result = eligibility_agent.run_program_change_agent("STUD_TEST_000001")
    assert result["agent_recommendation"] == recommendation
    assert result["deterministic_results"]["cgpa_eligible"] is (cgpa >= 2.0)


def test_unknown_request_is_not_found_without_gemini(agent):
    models, _ = agent(None)
    result = eligibility_agent.run_program_change_agent("STUD_TEST_404")
    assert result["status"] == "NOT_FOUND" and "report" not in result
    assert models.calls == []


def test_report_without_recommendation_is_an_error(agent):
    agent(program_change_request(approve_transcript()), STUDY_PLAN_REPLY, "ACADEMIC ASSESSMENT\nNo verdict.")
    with pytest.raises(ValueError, match="does not contain a valid recommendation"):
        eligibility_agent.run_program_change_agent("STUD_TEST_000001")


def test_empty_assessment_is_an_error(agent):
    agent(program_change_request(approve_transcript()), STUDY_PLAN_REPLY, "   ")
    with pytest.raises(ValueError, match="empty academic assessment"):
        eligibility_agent.run_program_change_agent("STUD_TEST_000001")


def test_temporary_errors_fall_back_to_the_next_model(agent):
    models, _ = agent(program_change_request(approve_transcript()),
                      server_error(503), server_error(500, "INTERNAL"), STUDY_PLAN_REPLY, report("APPROVE"))
    result = eligibility_agent.run_program_change_agent("STUD_TEST_000001")
    assert result["agent_recommendation"] == "APPROVE"
    assert [c["model"] for c in models.calls[:3]] == llm_client.GEMINI_MODELS[:3]


def test_gemini_unavailable_on_every_model_is_an_error(agent):
    agent(program_change_request(approve_transcript()), *[server_error()] * len(llm_client.GEMINI_MODELS))
    with pytest.raises(GeminiUnavailableError, match="every configured model"):
        eligibility_agent.run_program_change_agent("STUD_TEST_000001")


def test_a_non_temporary_gemini_error_stops_at_once(agent):
    models, _ = agent(program_change_request(approve_transcript()), client_error(403, "PERMISSION_DENIED"))
    with pytest.raises(GeminiUnavailableError, match="403"):
        eligibility_agent.run_program_change_agent("STUD_TEST_000001")
    assert len(models.calls) == 1


def test_unknown_grade_stops_the_run_after_the_study_plan(agent):
    request = program_change_request(approve_transcript() + [{"course_id": "X", "course_name": "X",
                                                              "credit_hours": 3, "grade": "WF", "term": 1}])
    models, _ = agent(request, STUDY_PLAN_REPLY)
    with pytest.raises(ValueError, match="Unknown grade: WF"):
        eligibility_agent.run_program_change_agent("STUD_TEST_000001")
    assert len(models.calls) == 1   # no assessment requested


# -- no Supabase, no RPC -----------------------------------------------------------------

def test_package_never_uses_supabase_or_an_rpc():
    for path in PACKAGE_DIR.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                assert not any(alias.name.split(".")[0] == "supabase" for alias in node.names), path.name
            if isinstance(node, ast.ImportFrom):
                assert (node.module or "").split(".")[0] not in ("supabase", "database", "dotenv"), path.name
            if isinstance(node, ast.Attribute):
                assert node.attr != "rpc", path.name

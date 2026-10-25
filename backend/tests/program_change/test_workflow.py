"""workflow.py runs Shaikha's agent unchanged: the same prompts, the same Gemini
calls and the same result as eligibility_agent.run_program_change_agent, plus
the evidence snapshot (reference-file fingerprints, not their text) and the
model of each call. Fake request reader and fake Gemini client only."""

import hashlib

import pytest

from app.agents.program_change_eligibility import eligibility_agent, evidence, llm_client, workflow
from app.core import gemini
from app.core.gemini import GeminiUnavailableError

from .fakes import (
    STUDY_PLAN_REPLY, FakeTextModels, approve_transcript, course, program_change_request, report, server_error,
)


@pytest.fixture
def agent(monkeypatch):
    """Fake request reader (for both modules that read it) and fake Gemini replies."""
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


# -- parity with the standalone entry point -----------------------------------------------

@pytest.mark.parametrize("recommendation, cgpa", [("APPROVE", 3.1), ("REJECT", 1.8), ("REQUIRES_REVIEW", 2.4)])
def test_same_prompts_calls_and_result_as_run_program_change_agent(agent, recommendation, cgpa):
    request = program_change_request(approve_transcript(), cgpa=cgpa)

    original_models, original_reads = agent(request, STUDY_PLAN_REPLY, report(recommendation))
    original = eligibility_agent.run_program_change_agent("STUD_TEST_000001")

    models, reads = agent(request, STUDY_PLAN_REPLY, report(recommendation))
    outcome = workflow.evaluate_program_change_request("STUD_TEST_000001")

    assert outcome.found is True
    assert outcome.result == original
    assert models.calls == original_models.calls     # identical prompts, models and configs
    assert reads == original_reads                    # same reads, same order


def test_not_found_matches_the_standalone_result(agent):
    original_models, _ = agent(None)
    original = eligibility_agent.run_program_change_agent("STUD_TEST_404")
    models, _ = agent(None)
    outcome = workflow.evaluate_program_change_request("STUD_TEST_404")
    assert outcome.found is False and outcome.result == original
    assert outcome.evidence is None and models.calls == original_models.calls == []


@pytest.mark.parametrize("make_request, replies, error, match", [
    (lambda: program_change_request(approve_transcript() + [course("X1", "WF")]), [STUDY_PLAN_REPLY],
     ValueError, "Unknown grade: WF"),
    (lambda: program_change_request(approve_transcript(), cgpa=None), [STUDY_PLAN_REPLY], ValueError, "CGPA is missing"),
    (lambda: program_change_request(approve_transcript()), [STUDY_PLAN_REPLY, "No verdict."],
     ValueError, "does not contain a valid recommendation"),
    (lambda: program_change_request(approve_transcript()), [server_error()] * 6, GeminiUnavailableError,
     "every configured model"),
])
def test_errors_propagate_exactly_as_in_the_standalone_agent(agent, make_request, replies, error, match):
    agent(make_request(), *replies)
    with pytest.raises(error, match=match):
        eligibility_agent.run_program_change_agent("STUD_TEST_000001")
    agent(make_request(), *replies)
    with pytest.raises(error, match=match):
        workflow.evaluate_program_change_request("STUD_TEST_000001")


# -- what the run history stores --------------------------------------------------------------

def test_evidence_snapshot_keeps_request_and_study_plan_but_not_reference_texts(agent):
    request = program_change_request(approve_transcript())
    agent(request, STUDY_PLAN_REPLY, report("APPROVE"))
    snapshot = workflow.evaluate_program_change_request("STUD_TEST_000001").evidence

    assert snapshot["request"] == request
    assert snapshot["current_program"] == request["current_program"]
    assert snapshot["requested_program"]["study_plan_source"]["courses"]
    assert [s["type"] for s in snapshot["sources"]][-1] == "requested_program_webpage"
    assert "program_change_constraints" not in snapshot and "university_courses" not in snapshot
    assert "T" in snapshot["collected_at"]


def test_reference_file_fingerprints():
    prints = workflow.reference_file_fingerprints()
    assert [p["file"] for p in prints] == [
        "data/bachelors_program_catalog.txt", "data/program_change_constraints.txt", "data/university_courses.txt"]
    for entry in prints:
        expected = hashlib.sha256((evidence.DATA_DIR / entry["file"].removeprefix("data/")).read_bytes()).hexdigest()
        assert entry["sha256"] == expected and len(entry["sha256"]) == 64


def test_models_of_both_calls_are_recorded_including_fallbacks(agent):
    agent(program_change_request(approve_transcript()),
          server_error(), STUDY_PLAN_REPLY,   # study plan: first model unavailable
          report("APPROVE"))                  # assessment: first model answers
    outcome = workflow.evaluate_program_change_request("STUD_TEST_000001")
    assert outcome.study_plan_model == llm_client.GEMINI_MODELS[1]
    assert outcome.assessment_model == llm_client.GEMINI_MODELS[0]


def test_model_recording_is_scoped_to_one_run(agent):
    agent(program_change_request(approve_transcript()), STUDY_PLAN_REPLY, report("APPROVE"))
    workflow.evaluate_program_change_request("STUD_TEST_000001")
    assert llm_client._calls.get() is None   # nothing keeps recording after the run

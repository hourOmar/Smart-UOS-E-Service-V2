"""The full pipeline with fakes: Agent 6 only after REJECT, every data and
request error raised before Gemini, nothing secret or binary in the outcome."""

import hashlib
import json

import pytest

from app.agents.incomplete_exam import proof_files, request_data, workflow
from app.agents.incomplete_exam.exceptions import IncompleteExamDetailsMissingError, ProofFileMissingError
from app.config import get_settings
from app.core import gemini, storage

from .fakes import PDF, REQUEST_ID, TOKEN, FakeClient, api_error, decision_reply, rejection_reply
from .fakes import request_data as make_request_data

# SHA-256 of the files as stored in git (LF; .gitattributes keeps every checkout LF).
POLICY_SHA256 = "a8b944c4928edd414aa122538c6187cc2ce0d54f3c4df1f167324dc605e84025"
KEYWORDS_SHA256 = "c73163803fb20463a422fd993f5a79fc2bfdd6330d4e27f84b7aa84842e0e572"


@pytest.fixture
def env(monkeypatch):
    state = {"downloads": [], "data": make_request_data()}

    def fake_data(request_id):
        if isinstance(state["data"], BaseException):
            raise state["data"]
        return state["data"]

    def fake_download(bucket, path, access_token, *, max_bytes):
        state["downloads"].append(access_token)
        value = state.get("object", PDF)
        if isinstance(value, BaseException):
            raise value
        return value

    def install_gemini(outcomes):
        client = FakeClient(outcomes)
        monkeypatch.setattr(gemini, "get_client", lambda: client)
        state["models"] = client.models

    monkeypatch.setattr(request_data, "get_incomplete_exam_request_data", fake_data)
    monkeypatch.setattr(proof_files.storage, "download_object", fake_download)
    monkeypatch.setattr(gemini, "_sleep", lambda seconds: None)
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaSyFAKE-test-key-0123456789abcdefghij")
    get_settings.cache_clear()
    state["gemini"] = install_gemini
    return state


def test_knowledge_files_are_unchanged():
    assert workflow.knowledge_file_fingerprints() == [
        {"file": "knowledge_base/incomplete_exam_policy.json", "sha256": POLICY_SHA256},
        {"file": "knowledge_base/rejection_keywords.json", "sha256": KEYWORDS_SHA256},
    ]
    for name, digest in (("incomplete_exam_policy.json", POLICY_SHA256), ("rejection_keywords.json", KEYWORDS_SHA256)):
        assert hashlib.sha256((workflow.KNOWLEDGE_DIR / name).read_bytes()).hexdigest() == digest


def test_reject_runs_both_agents(env):
    env["gemini"]([decision_reply("REJECT"), rejection_reply()])
    outcome = workflow.run_incomplete_exam_agents(REQUEST_ID, TOKEN)
    assert list(outcome.agent5) == ["request_id", "evidence", "recommendation", "reasoning", "checks",
                                    "gemini_status", "gemini_error"]
    assert outcome.agent5["recommendation"] == "REJECT" and outcome.agent5["gemini_status"] == "ok"
    assert outcome.agent6["request_id"] == REQUEST_ID and outcome.agent6["status"] == "ok"
    assert outcome.agent6["judgment_keywords"] == ["proof_inconsistent_or_unverifiable"]
    assert outcome.assessment_model == "test-model" and outcome.rejection_model == "test-model"
    assert len(env["models"].calls) == 2 and env["downloads"] == [TOKEN]
    assert outcome.proof_files[0]["outcome"] == "attached"
    assert outcome.evidence["knowledge_files"][0]["sha256"] == POLICY_SHA256 and "collected_at" in outcome.evidence


def test_approve_skips_agent6(env):
    env["gemini"]([decision_reply("APPROVE")])
    outcome = workflow.run_incomplete_exam_agents(REQUEST_ID, TOKEN)
    assert outcome.agent6["status"] == "not_applicable" and outcome.rejection_model is None
    assert len(env["models"].calls) == 1


def test_outcome_holds_no_token_and_no_file_bytes(env):
    env["gemini"]([decision_reply("REJECT"), rejection_reply()])
    outcome = workflow.run_incomplete_exam_agents(REQUEST_ID, TOKEN)
    stored = json.dumps([outcome.agent5, outcome.agent6, outcome.evidence, outcome.proof_files], default=str)
    assert TOKEN not in stored and "synthetic proof document" not in stored
    assert TOKEN not in repr(outcome)


def test_details_missing_stops_before_storage_and_gemini(env):
    env["data"] = IncompleteExamDetailsMissingError("missing")
    env["gemini"]([])
    with pytest.raises(IncompleteExamDetailsMissingError):
        workflow.run_incomplete_exam_agents(REQUEST_ID, TOKEN)
    assert env["downloads"] == [] and env["models"].calls == []


def test_missing_file_stops_before_gemini(env):
    env["object"] = storage.StorageObjectNotFoundError("x")
    env["gemini"]([])
    with pytest.raises(ProofFileMissingError):
        workflow.run_incomplete_exam_agents(REQUEST_ID, TOKEN)
    assert env["models"].calls == []


def test_storage_outage_is_not_treated_as_no_file(env):
    env["object"] = storage.StorageUnavailableError("x")
    env["gemini"]([])
    with pytest.raises(storage.StorageUnavailableError):
        workflow.run_incomplete_exam_agents(REQUEST_ID, TOKEN)
    assert env["models"].calls == []


def test_gemini_failure_has_no_recommendation(env):
    env["gemini"]([api_error(503)])
    with pytest.raises(gemini.GeminiUnavailableError):
        workflow.run_incomplete_exam_agents(REQUEST_ID, TOKEN)


def test_no_proof_paths_sends_the_prompt_alone(env):
    env["data"] = make_request_data(proof_paths=[])
    env["gemini"]([decision_reply("MANUAL_REVIEW")])
    outcome = workflow.run_incomplete_exam_agents(REQUEST_ID, TOKEN)
    assert env["downloads"] == [] and isinstance(env["models"].calls[0]["contents"], str)
    assert outcome.agent5["evidence"]["checks"]["proof"]["file_attached"] is False

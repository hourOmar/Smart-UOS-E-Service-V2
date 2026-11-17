"""The Gemini calls go through app.core.gemini with the configured models, the unchanged
system instructions and temperatures, and raise on failure (never MANUAL_REVIEW)."""

import pytest

from app.agents.course_equivalency import gemini_calls, llm_calls, rejection_gemini
from app.core import gemini as core_gemini
from app.core.gemini import GeminiUnavailableError

from .fakes import RID


@pytest.fixture
def settings(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-key")
    monkeypatch.setenv("GEMINI_MODEL", "primary-model")
    monkeypatch.setenv("GEMINI_FALLBACK_MODELS", "fallback-a,fallback-b")
    from app.config import get_settings
    get_settings.cache_clear()


def _analysis_reply():
    course = {"title": "T", "credit_hours": 3, "topics": ["loops"], "learning_outcomes": ["write code"], "assessment": {}}
    return gemini_calls._SyllabusAnalysis.model_validate({
        "old": course, "new": course,
        "topic_matches": [{"new_index": 0, "old_index": 0, "strength": "full", "old_quote": "Loops and iteration basics",
                           "new_quote": "Loops and iteration basics"}],
        "outcome_matches": []})


def test_analysis_uses_configured_models_rules_and_temperature(monkeypatch, settings):
    seen = {}

    def fake(prompt, schema, **kw):
        seen.update(kw, prompt=prompt, schema=schema)
        return _analysis_reply(), "fallback-a"
    monkeypatch.setattr(gemini_calls, "generate_structured_with_model", fake)
    with llm_calls.recording_calls() as calls:
        out = gemini_calls.analyze_syllabi("Loops and iteration basics old", "Loops and iteration basics new", RID)
    assert seen["model"] == "primary-model" and tuple(seen["fallback_models"]) == ("fallback-a", "fallback-b")
    assert seen["system_instruction"] == gemini_calls._ANALYSIS_RULES and seen["temperature"] == 0.0
    assert seen["prompt"].startswith("=== OLD COURSE SYLLABUS ===\n") and seen["schema"] is gemini_calls._SyllabusAnalysis
    assert out["analysis"]["verification"]["claimed_total"] == 1 and calls == [{"agent": "syllabus_analysis", "model": "fallback-a"}]


def test_decision_receives_the_reduced_evidence(monkeypatch, settings):
    seen = {}
    reply = gemini_calls._Decision.model_validate({"recommendation": "MANUAL_REVIEW", "reasoning": "r", "checks": [],
                                                   "major_similarities": [], "major_differences": []})

    def fake(prompt, schema, **kw):
        seen.update(kw, prompt=prompt)
        return reply, "primary-model"
    monkeypatch.setattr(gemini_calls, "generate_structured_with_model", fake)
    ev = {"request": {"request_id": RID, "reason": "SECRET-REASON", "other_request_fields": {"Program_Change_Request_ID": "PCR-1",
                                                                                            "Plan_Version": "V1"}},
          "student": {"student_id": "U99000001", "name": "Synthetic Distinctname", "cgpa": 3.9, "completed_hours": 70,
                      "program_id": "1501", "program_name": "CS"},
          "syllabi": {"old": {"filename": "old-Synthetic.pdf", "readable": True}, "new": {"filename": "n.pdf", "readable": True}}}
    out = gemini_calls.get_gemini_decision(ev)
    assert out["recommendation"] == "MANUAL_REVIEW" and out["model"] == "primary-model"
    assert seen["system_instruction"] == gemini_calls._DECISION_RULES and seen["temperature"] == 0.0
    for secret in ("SECRET-REASON", "PCR-1", "U99000001", "Synthetic", "3.9", "completed_hours", "old-Synthetic"):
        assert secret not in seen["prompt"], secret
    assert '"Plan_Version": "V1"' in seen["prompt"] and ev["student"]["name"] == "Synthetic Distinctname"   # original untouched


def test_failures_raise_gemini_unavailable(monkeypatch, settings):
    def failing(*a, **k):
        raise GeminiUnavailableError("Gemini request failed on every configured model: x")
    monkeypatch.setattr(gemini_calls, "generate_structured_with_model", failing)
    with pytest.raises(GeminiUnavailableError):
        gemini_calls.analyze_syllabi("a", "b")
    with pytest.raises(GeminiUnavailableError):
        gemini_calls.get_gemini_decision({"request": {}, "student": {}, "syllabi": {}})


def test_no_key_raises_through_the_core_client():
    core_gemini._client = None
    with pytest.raises(GeminiUnavailableError):
        gemini_calls.get_gemini_decision({"request": {}, "student": {}, "syllabi": {}})


def test_rejection_suggestions_keep_the_standalone_statuses(monkeypatch, settings):
    def failing(*a, **k):
        raise GeminiUnavailableError("Gemini request failed: 503")
    monkeypatch.setattr(rejection_gemini, "generate_structured_with_model", failing)
    assert rejection_gemini.get_rejection_suggestions({"request_id": RID})["status"] == "error"
    seen = {}
    reply = rejection_gemini._RejectionSuggestions.model_validate({"judgment_keywords": [], "suggested_reasons": [], "conflict_note": ""})

    def fake(prompt, schema, **kw):
        seen.update(kw)
        return reply, "primary-model"
    monkeypatch.setattr(rejection_gemini, "generate_structured_with_model", fake)
    assert rejection_gemini.get_rejection_suggestions({"request_id": RID})["status"] == "ok"
    assert seen["temperature"] == 0.3 and seen["system_instruction"] == rejection_gemini._RULES


def test_rejection_without_key_is_unavailable():
    assert rejection_gemini.get_rejection_suggestions({"request_id": RID})["status"] == "unavailable"

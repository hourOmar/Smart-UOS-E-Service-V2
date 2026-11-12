"""The rejection step (rejection_agent, rejection_gemini and the three tools) with
a fake Gemini: only for NOT_ELIGIBLE, keyword mapping, validation of Gemini's
reply, the template fallback and sanitized errors (contract section 6)."""

import hashlib
import json

import pytest

from app.agents.course_substitution_eligibility import rejection_gemini
from app.agents.course_substitution_eligibility.exceptions import InvalidEligibilityResultError
from app.agents.course_substitution_eligibility.rejection_agent import explain_rejection_workflow
from app.agents.course_substitution_eligibility.rejection_keyword_tools import (
    detect_deterministic_keywords, judgment_keyword_options,
)

from .fakes import FAKE_KEY, STUDENT_ID, STUDENT_NAME, api_error, install_fake_gemini, load_vocabulary, rejection_reply

# The standalone RULES text (commit 32f83d3).
RULES_SHA256 = "70a279d0f1c3cb74aed79207dac39f34528a40fb7184e994c0b02f32de9eb9fd"
FALLBACK_NOTE = ("Gemini suggestions were unavailable or did not pass validation. "
                 "These explanations were generated from verified rejection reasons.")

CONDITIONS = [
    ("Original course unavailable before graduation", "original_course_offered_before_graduation"),
    ("Proposed course is at the same level or higher", "proposed_course_lower_level"),
    ("Original course is a core course", "original_course_not_core"),
    ("Proposed course is offered in the current semester", "proposed_course_not_offered"),
    ("Proposed course has not been completed previously", "proposed_course_already_completed"),
]


def result(overall, statuses):
    return {"overall_result": overall, "checks": [
        {"condition": condition, "status": status, "evidence": f"Evidence {i}."}
        for i, ((condition, _), status) in enumerate(zip(CONDITIONS, statuses))]}


LOWER_LEVEL_ONLY = result("NOT_ELIGIBLE", ["PASS", "FAIL", "PASS", "PASS", "PASS"])


# --- when it runs ---------------------------------------------------------------

@pytest.mark.parametrize("overall", ["ELIGIBLE", "MANUAL_REVIEW"])
def test_not_applicable_without_a_gemini_call(monkeypatch, overall):
    models = install_fake_gemini(monkeypatch)
    out = explain_rejection_workflow(result(overall, ["PASS"] * 5))
    assert out == {
        "status": "not_applicable", "overall_result": overall,
        "message": f"The eligibility agent returned {overall}. "
                   "Rejection explanations are only generated for NOT_ELIGIBLE requests.",
        "deterministic_keywords": [], "judgment_keywords": [], "suggested_reasons": [], "conflict_note": "",
    }
    assert models.calls == []


@pytest.mark.parametrize("bad", [
    None, [], {"checks": []}, {"overall_result": "REJECT", "checks": []},
    {"overall_result": "NOT_ELIGIBLE"}, {"overall_result": "NOT_ELIGIBLE", "checks": ["x"]},
    {"overall_result": "NOT_ELIGIBLE", "checks": [{"condition": "c", "status": "FAIL"}]},
    {"overall_result": "NOT_ELIGIBLE", "checks": [{"condition": "c", "status": "NO", "evidence": ""}]},
])
def test_invalid_eligibility_result_raises(monkeypatch, bad):
    models = install_fake_gemini(monkeypatch)
    with pytest.raises(InvalidEligibilityResultError):
        explain_rejection_workflow(bad)
    assert models.calls == []


# --- keywords -------------------------------------------------------------------

def test_keyword_mapping_keeps_check_order():
    vocabulary = load_vocabulary()
    found = detect_deterministic_keywords(result("NOT_ELIGIBLE", ["FAIL"] * 5)["checks"], vocabulary)
    assert [k["keyword"] for k in found] == [keyword for _, keyword in CONDITIONS]
    assert found[1] == {"keyword": "proposed_course_lower_level", **{
        field: vocabulary["proposed_course_lower_level"][field]
        for field in ("label", "policy_basis", "plain_reason")}}


def test_keywords_missing_from_the_vocabulary_or_unknown_conditions_are_skipped():
    vocabulary = load_vocabulary()
    del vocabulary["proposed_course_lower_level"]
    checks = result("NOT_ELIGIBLE", ["FAIL", "FAIL", "PASS", "PASS", "FAIL"])["checks"]
    checks.append({"condition": "Something else", "status": "FAIL", "evidence": ""})
    assert [k["keyword"] for k in detect_deterministic_keywords(checks, vocabulary)] == [
        "original_course_offered_before_graduation", "proposed_course_already_completed"]


def test_judgment_options_are_the_closed_list():
    assert [o["keyword"] for o in judgment_keyword_options(load_vocabulary())] == [
        "graduation_timing_not_satisfied", "study_plan_requirement_not_confirmed",
        "course_offering_information_uncertain"]


# --- the Gemini call ------------------------------------------------------------

def test_rules_and_prompt_are_unchanged_without_url_context(monkeypatch):
    assert hashlib.sha256(rejection_gemini.RULES.encode()).hexdigest() == RULES_SHA256
    models = install_fake_gemini(monkeypatch, json.dumps(rejection_reply(["proposed_course_lower_level"])))
    explain_rejection_workflow(LOWER_LEVEL_ONLY)
    (call,) = models.calls
    assert call["config"] is None
    prefix = rejection_gemini.RULES + "\n\nCOURSE SUBSTITUTION ELIGIBILITY CONTEXT:\n"
    assert call["contents"].startswith(prefix)
    context = json.loads(call["contents"][len(prefix):])
    assert set(context) == {"overall_result", "checks", "deterministic_keywords", "judgment_keyword_options"}
    for identity in (STUDENT_ID, STUDENT_NAME):
        assert identity not in call["contents"]


def test_valid_reply_is_used(monkeypatch):
    reply = rejection_reply(["proposed_course_lower_level"], judgment=["course_offering_information_uncertain"],
                            conflict_note="")
    reply["suggested_reasons"][0]["addresses_keywords"] = []       # allowed: kept as is
    reply["suggested_reasons"][2]["addresses_keywords"].append("course_offering_information_uncertain")
    install_fake_gemini(monkeypatch, "```json\n" + json.dumps(reply) + "\n```")
    out = explain_rejection_workflow(LOWER_LEVEL_ONLY)
    assert out["status"] == "gemini"
    assert out["fallback_note"] is None and out["gemini_error"] is None
    assert out["judgment_keywords"] == ["course_offering_information_uncertain"]
    assert out["suggested_reasons"] == reply["suggested_reasons"]
    assert [k["keyword"] for k in out["deterministic_keywords"]] == ["proposed_course_lower_level"]


def broken(change):
    reply = rejection_reply(["proposed_course_lower_level"])
    change(reply)
    return reply


INVALID_REPLIES = {
    "unknown judgment keyword": broken(lambda r: r.update(judgment_keywords=["made_up"])),
    "two reasons": broken(lambda r: r["suggested_reasons"].pop()),
    "four reasons": broken(lambda r: r["suggested_reasons"].append(dict(r["suggested_reasons"][0]))),
    "bad tone": broken(lambda r: r["suggested_reasons"][0].update(tone="angry")),
    "duplicate tone": broken(lambda r: r["suggested_reasons"][1].update(tone="formal")),
    "empty text": broken(lambda r: r["suggested_reasons"][1].update(text="  ")),
    "reason not an object": broken(lambda r: r["suggested_reasons"].__setitem__(0, "text")),
    "keywords not a list": broken(lambda r: r["suggested_reasons"][0].update(addresses_keywords="x")),
    "keyword outside the allowed set": broken(
        lambda r: r["suggested_reasons"][0]["addresses_keywords"].append("original_course_not_core")),
    "uncovered deterministic keyword": broken(
        lambda r: [reason.update(addresses_keywords=[]) for reason in r["suggested_reasons"]]),
}


@pytest.mark.parametrize("reply", INVALID_REPLIES.values(), ids=INVALID_REPLIES.keys())
def test_invalid_reply_falls_back(monkeypatch, reply):
    install_fake_gemini(monkeypatch, json.dumps(reply))
    out = explain_rejection_workflow(LOWER_LEVEL_ONLY)
    assert out["status"] == "fallback"
    assert out["fallback_note"] == FALLBACK_NOTE and out["gemini_error"] is None
    assert out["judgment_keywords"] == [] and out["conflict_note"] == ""


@pytest.mark.parametrize("text, error", [
    ('{"judgment_keywords": "x", "suggested_reasons": []}', "ValueError: Gemini returned invalid judgment_keywords."),
    ('{"suggested_reasons": {}}', "ValueError: Gemini returned invalid suggested_reasons."),
    ('{"conflict_note": 3}', "ValueError: Gemini returned an invalid conflict_note."),
    ("no json here", "ValueError: No JSON object found in Gemini's response."),
    ("[1, 2]", "ValueError: No JSON object found in Gemini's response."),
])
def test_unusable_reply_is_an_error_and_falls_back(monkeypatch, text, error):
    install_fake_gemini(monkeypatch, text)
    out = explain_rejection_workflow(LOWER_LEVEL_ONLY)
    assert out["status"] == "fallback" and out["gemini_error"] == error


def test_gemini_failure_falls_back_with_a_sanitized_error(monkeypatch):
    leak = f"denied key={FAKE_KEY} {STUDENT_ID} someone@uos.ac.ae"
    install_fake_gemini(monkeypatch, api_error(403, leak))
    out = explain_rejection_workflow(LOWER_LEVEL_ONLY)
    assert out["status"] == "fallback"
    assert out["gemini_error"].startswith(
        "GeminiUnavailableError: Gemini request failed: ClientError 403 PERMISSION_DENIED")
    for secret in (FAKE_KEY, STUDENT_ID, "someone@uos.ac.ae"):
        assert secret not in out["gemini_error"]


def test_fallback_without_deterministic_keywords_has_no_reasons(monkeypatch):
    install_fake_gemini(monkeypatch, api_error(503))
    out = explain_rejection_workflow({"overall_result": "NOT_ELIGIBLE", "checks": [
        {"condition": "Something else", "status": "FAIL", "evidence": ""}]})
    assert out["status"] == "fallback" and out["deterministic_keywords"] == [] and out["suggested_reasons"] == []


def test_any_exception_text_is_sanitized_in_gemini_error(monkeypatch):
    def leaking(prompt, use_url_context=False):
        raise RuntimeError(f"failed with key={FAKE_KEY} for {STUDENT_ID} at someone@uos.ac.ae")
    monkeypatch.setattr(rejection_gemini, "generate_with_fallback", leaking)
    out = explain_rejection_workflow(LOWER_LEVEL_ONLY)
    assert out["status"] == "fallback" and out["gemini_error"].startswith("RuntimeError: failed with key=")
    for secret in (FAKE_KEY, STUDENT_ID, "someone@uos.ac.ae"):
        assert secret not in out["gemini_error"]

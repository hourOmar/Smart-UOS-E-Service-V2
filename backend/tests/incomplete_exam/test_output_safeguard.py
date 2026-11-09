"""Output safeguard (agent 1.2.0): student identity and unsupported
document-verification claims never reach stored Gemini-generated text, while
the recommendation, verified checks, evidence, prompts and legitimate
database-verification statements stay unchanged. Synthetic data only."""

import json

import pytest

from app.agents.incomplete_exam import AGENT_VERSION, eligibility_decision, proof_files, rejection_gemini
from app.agents.incomplete_exam import request_data, workflow
from app.agents.incomplete_exam.output_safeguard import OutputSafeguard
from app.config import get_settings
from app.core import gemini

from .fakes import PDF, REQUEST_ID, STUDENT_ID, STUDENT_NAME, TOKEN, FakeClient, decision_reply, rejection_reply
from .fakes import request_data as make_request_data

NAME = "Mariam Khalid Distinctname"
SID = "U99000001"


def guard(name=NAME, sid=SID):
    return OutputSafeguard(name, sid)


# -- identity ----------------------------------------------------------------------------

@pytest.mark.parametrize("text, expected", [
    ("The certificate was issued for Mariam Khalid Distinctname.", "The certificate was issued for the student."),
    ("Issued for mariam   khalid\ndistinctname on 9 December.", "Issued for the student on 9 December."),
    ("Mariam Distinctname's report describes an injury.", "The student's report describes an injury."),
    ("Report for MARIAM DISTINCTNAME.", "Report for the student."),
    ("Distinctname was injured.", "The student was injured."),
    ("Khalid attended the clinic.", "The student attended the clinic."),
    ("Student U99000001 and U12345678 filed late.", "Student [student ID] and [student ID] filed late."),
    ("Contact mariam.k@example.ac.ae for details.", "Contact [email] for details."),
])
def test_identity_is_replaced(text, expected):
    assert guard().redact_identity(text) == expected


def test_arabic_script_names_are_replaced():
    g = OutputSafeguard("مريم خالد", SID)
    assert g.redact_identity("صدرت الشهادة باسم مريم خالد") == "صدرت الشهادة باسم the student"
    assert g.contains_identity("مريم")


@pytest.mark.parametrize("name, kept_text", [
    ("Grace Final", "The Final exam was missed; grace periods do not apply."),
    ("Hope Al Section", "We hope the Section 61 schedule is clear."),
    ("Mark Will", "The mark will be recorded."),
    ("Jo Medical", "A Medical certificate was attached for Jo."),      # "Jo" is too short to match alone
])
def test_ambiguous_name_parts_are_never_replaced_alone(name, kept_text):
    g = OutputSafeguard(name, None)
    assert g.redact_identity(kept_text) == kept_text
    assert g.report.identity_replacements == 0


def test_a_name_of_ordinary_words_is_still_replaced_as_a_proper_noun():
    assert OutputSafeguard("Mark Will", None).redact_identity("The report names Mark Will.") == "The report names the student."


def test_ordinary_lowercase_words_that_equal_a_name_part_are_kept():
    g = OutputSafeguard("Amira Rose", None)
    assert g.redact_identity("Amira bought a rose.") == "The student bought a rose."
    assert OutputSafeguard.part_forms("Grace Al Final Hope Mariam") == ["MARIAM", "Mariam"]


def test_course_codes_and_the_phrase_the_student_are_untouched():
    text = "The student was enrolled in course 1501116, section 61, term 202401."
    assert guard().redact_identity(text) == text


def test_no_known_identity_still_removes_generic_ids():
    assert OutputSafeguard(None, None).redact_identity("U12345678 wrote to a@b.co") == "[student ID] wrote to [email]"


# -- document-verification wording --------------------------------------------------------

@pytest.mark.parametrize("text, expected", [
    ("The documents match the claim and provide verified proof.",
     "The documents appear consistent with the claim and provide supporting proof."),
    ("Document 1 is an official Dubai Health Authority Medical Certificate.",
     "Document 1 is a Dubai Health Authority Medical Certificate."),
    ("The reason is supported by an authenticated medical report from an approved healthcare facility (DHA).",
     "The reason is supported by a medical report from a healthcare facility (DHA)."),
    ("The attached report is verified.", "The attached report was reviewed."),
    ("The attached reports are authenticated.", "The attached reports were reviewed."),
    ("The certificate is genuine.", "The certificate appears genuine."),
    ("The police report confirms the accident.", "The police report states the accident."),
    ("The itinerary proves the travel dates.", "The itinerary states the travel dates."),
    ("The documents verifiably show the injury.", "The documents show the injury."),
    ("The letter matches the stated reason.", "The letter appears consistent with the stated reason."),
])
def test_document_claims_are_rewritten_neutrally(text, expected):
    g = guard()
    assert g.neutralise_verification(text) == expected
    assert g.report.verification_rewrites >= 1


@pytest.mark.parametrize("text", [
    "Enrollment is verifiably confirmed for course 1501116, section 61, term 202401.",
    "Enrollment is verified for course 1501215.",
    "The Takes record was verified; the submission window is satisfied (0 working days).",
    "The request was approved by the Dean after the report was filed.",
    "File attached is false (no document uploaded), so the proof claim is unverified.",
    "The student could not verify the schedule.",
])
def test_database_and_neutral_statements_are_preserved(text):
    g = guard()
    assert g.neutralise_verification(text) == text
    assert g.report.verification_rewrites == 0


def test_rewrites_add_no_conclusion_of_consistency_when_none_was_stated():
    out = guard().clean_text("The attached certificate is verified and it confirms an appointment.")
    assert out == "The attached certificate was reviewed and it states an appointment."
    assert "consistent" not in out


def test_agent6_verification_claims_are_detected_but_negations_are_not():
    g = guard()
    assert g.claims_verification("Your medical certificate was verified, but the window had passed.")
    assert g.claims_verification("The official documents show the dates.")
    assert not g.claims_verification("Your document could not be verified as an accepted category.")
    assert not g.claims_verification("The document was not authenticated.")
    assert not g.claims_verification("Your request was filed after the allowed window.")


# -- Agent 5 / Agent 6 results ------------------------------------------------------------------

def agent5_result(recommendation="APPROVE"):
    return {"request_id": REQUEST_ID, "evidence": {"checks": {}}, "recommendation": recommendation,
            "reasoning": f"Two documents for {NAME} ({SID}) were attached and provide verified proof.",
            "checks": {"proof": f"The official certificate issued for {NAME} matches the claim.",
                       "enrollment": "Enrollment is verifiably confirmed for course 1501116."},
            "gemini_status": "ok", "gemini_error": None}


def test_clean_agent5_changes_only_generated_text():
    raw = agent5_result()
    cleaned = guard().clean_agent5(raw)
    assert cleaned["recommendation"] == raw["recommendation"] and cleaned["evidence"] is raw["evidence"]
    assert cleaned["reasoning"] == "Two documents for the student ([student ID]) were attached and provide supporting proof."
    assert cleaned["checks"]["proof"] == "The certificate issued for the student appears consistent with the claim."
    assert cleaned["checks"]["enrollment"] == raw["checks"]["enrollment"]
    assert raw["reasoning"].startswith("Two documents for Mariam")          # the input is not mutated


def agent6_result(texts, keywords=()):
    return {"request_id": REQUEST_ID, "status": "ok", "gemini_status": "ok", "gemini_error": None,
            "deterministic_keywords": [{"keyword": k, "label": k, "policy_basis": "p",
                                        "plain_reason": f"Template reason for {k}."} for k in keywords],
            "judgment_keywords": [],
            "suggested_reasons": [{"tone": tone, "text": text, "addresses_keywords": ["late_submission"]}
                                  for tone, text in zip(("formal", "concise", "supportive"), texts)],
            "conflict_note": f"Agent 5 named {NAME}."}


def test_agent6_unsafe_suggestions_are_dropped_and_safe_ones_kept():
    g = guard()
    out = g.check_agent6(agent6_result([
        "Your request was filed after the allowed window.",
        f"Dear {NAME}, your request was filed late.",
        "Your verified certificate does not change the deadline.",
    ]))
    assert [s["tone"] for s in out["suggested_reasons"]] == ["formal"]
    assert out["status"] == "ok" and out["conflict_note"] == "Agent 5 named the student."
    assert g.report.suggestions_dropped == 2 and g.report.dropped_reasons == ["identity", "verification_claim"]


def test_agent6_template_fallback_when_every_suggestion_is_dropped():
    out = guard().check_agent6(agent6_result([f"{NAME}: late.", f"Student {SID}: late."], keywords=["late_submission"]))
    assert out["status"] == "fallback"
    assert out["suggested_reasons"] == [{"tone": "formal", "text": "Template reason for late_submission.",
                                         "addresses_keywords": ["late_submission"]}]
    assert out["gemini_error"] == "No suggested reason passed the output safeguard."


def test_agent6_needs_manual_explanation_without_verified_keywords():
    out = guard().check_agent6(agent6_result([f"{NAME}: rejected."]))
    assert out["status"] == "needs_manual_explanation" and out["suggested_reasons"] == []


def test_agent6_not_applicable_is_untouched():
    result = {"request_id": REQUEST_ID, "status": "not_applicable", "suggested_reasons": [], "conflict_note": ""}
    assert guard().check_agent6(result) is result


# -- through the workflow: APPROVE and REJECT ------------------------------------------------

@pytest.fixture
def env(monkeypatch):
    state = {"downloads": []}

    def fake_download(bucket, path, access_token, *, max_bytes):
        state["downloads"].append(path)
        return PDF

    def install_gemini(outcomes):
        client = FakeClient(outcomes)
        monkeypatch.setattr(gemini, "get_client", lambda: client)
        state["models"] = client.models

    monkeypatch.setattr(request_data, "get_incomplete_exam_request_data", lambda rid: make_request_data())
    monkeypatch.setattr(proof_files.storage, "download_object", fake_download)
    monkeypatch.setattr(gemini, "_sleep", lambda seconds: None)
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaSyFAKE-test-key-0123456789abcdefghij")
    get_settings.cache_clear()
    state["gemini"] = install_gemini
    return state


def leaky_decision(recommendation):
    return decision_reply(
        recommendation,
        reasoning=f"The attached documents for {STUDENT_NAME} ({STUDENT_ID}) provide verified proof.",
        proof_explanation=f"Document 1 is an official medical certificate for {STUDENT_NAME}; it confirms the injury.",
        enrollment_explanation="Enrollment is verifiably confirmed for course 1501215.",
    )


def stored_text(outcome) -> str:
    return json.dumps([outcome.agent5["reasoning"], outcome.agent5["checks"], outcome.agent6], default=str)


def test_approve_path_is_cleaned_and_agent6_is_skipped(env):
    env["gemini"]([leaky_decision("APPROVE")])
    outcome = workflow.run_incomplete_exam_agents(REQUEST_ID, TOKEN)
    assert outcome.agent5["recommendation"] == "APPROVE"                     # never changed
    assert outcome.agent6["status"] == "not_applicable" and len(env["models"].calls) == 1
    text = stored_text(outcome)
    assert STUDENT_NAME not in text and STUDENT_ID not in text and "verified proof" not in text
    assert outcome.agent5["reasoning"] == "The attached documents for the student ([student ID]) provide supporting proof."
    assert outcome.agent5["checks"]["proof"] == "Document 1 is a medical certificate for the student; it states the injury."
    assert outcome.agent5["checks"]["enrollment"] == "Enrollment is verifiably confirmed for course 1501215."
    # 3 in the leaky texts, plus the fake's default reason explanation
    # "Synthetic." -- "Synthetic" is a part of the fake student's name.
    assert outcome.evidence["output_safeguard"]["identity_replacements"] == 4
    assert outcome.agent5["checks"]["reason_validity"] == "The student."
    assert outcome.evidence["output_safeguard"]["suggestions_dropped"] == 0
    # The verified checks are untouched, and the stored evidence keeps the
    # student for staff; Gemini still never received it.
    assert outcome.agent5["evidence"]["checks"]["proof"]["file_attached"] is True
    assert outcome.evidence["student"]["Student_Name"] == STUDENT_NAME
    assert STUDENT_NAME not in env["models"].calls[0]["contents"][0]


def test_reject_path_agent6_never_sees_the_name_and_unsafe_suggestions_are_dropped(env):
    leaky_reasons = rejection_reply(suggested_reasons=[
        {"tone": "formal", "text": "Your document could not be accepted for this request.",
         "addresses_keywords": ["proof_inconsistent_or_unverifiable"]},
        {"tone": "concise", "text": f"{STUDENT_NAME}, your document could not be accepted.",
         "addresses_keywords": ["proof_inconsistent_or_unverifiable"]},
        {"tone": "supportive", "text": "Although your certificate was verified, it does not support the reason.",
         "addresses_keywords": ["proof_inconsistent_or_unverifiable"]},
    ])
    env["gemini"]([leaky_decision("REJECT"), leaky_reasons])
    outcome = workflow.run_incomplete_exam_agents(REQUEST_ID, TOKEN)
    assert outcome.agent5["recommendation"] == "REJECT"
    agent6_prompt = env["models"].calls[1]["contents"]
    assert STUDENT_NAME not in agent6_prompt and STUDENT_ID not in agent6_prompt
    assert "verified proof" not in agent6_prompt
    assert [s["tone"] for s in outcome.agent6["suggested_reasons"]] == ["formal"]
    assert outcome.agent6["status"] == "ok"
    assert outcome.evidence["output_safeguard"]["suggestions_dropped"] == 2
    assert STUDENT_NAME not in stored_text(outcome) and STUDENT_ID not in stored_text(outcome)


def test_reject_path_all_suggestions_dropped_uses_the_verified_templates(env, monkeypatch):
    late = make_request_data()
    late.request["Request_Date"] = late.request["Missed_Exam_Date"].replace(day=20)   # filed late
    monkeypatch.setattr(request_data, "get_incomplete_exam_request_data", lambda rid: late)
    unsafe = rejection_reply(judgment_keywords=[], suggested_reasons=[
        {"tone": tone, "text": f"{STUDENT_NAME}, you filed late.", "addresses_keywords": ["late_submission"]}
        for tone in ("formal", "concise", "supportive")])
    env["gemini"]([decision_reply("REJECT"), unsafe])
    outcome = workflow.run_incomplete_exam_agents(REQUEST_ID, TOKEN)
    assert outcome.agent6["status"] == "fallback"
    assert [k["keyword"] for k in outcome.agent6["deterministic_keywords"]] == ["late_submission"]
    assert "working days after the missed exam" in outcome.agent6["suggested_reasons"][0]["text"]
    assert STUDENT_NAME not in stored_text(outcome)


def test_version_bumped_and_prompts_untouched():
    # The prompt texts are pinned by SHA-256 in test_eligibility_decision and
    # test_rejection_agent (unchanged); the safeguard adds no instruction to them.
    assert AGENT_VERSION == "1.3.0"   # 1.2.0 added the safeguard; 1.3.0 the no-proof keyword fix
    assert "safeguard" not in eligibility_decision._DECISION_RULES.lower()
    assert "safeguard" not in rejection_gemini._RULES.lower()

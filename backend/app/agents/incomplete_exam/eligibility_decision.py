"""Agent 5's Gemini step: Gemini is the decision-making layer.

Python only collects and computes verified evidence; it does NOT combine that
evidence into a final APPROVE/REJECT/MANUAL_REVIEW recommendation itself.
Gemini receives the evidence package plus explicit decision rules (and the
proof documents as attachments) and produces the recommendation and an
explanation for each check.

Unchanged from the standalone services/gemini.py: _DECISION_RULES,
_ATTACHMENT_INSTRUCTIONS, the reply schema _IncompleteExamDecision, how the
prompt is assembled and how the reply is mapped. Changes (see __init__):
the call goes through app.core.gemini with the configured fallback models;
Gemini failures raise instead of returning MANUAL_REVIEW; the student's
identity is removed from the evidence Gemini sees; the recommendation value
is checked.
"""

import json

from pydantic import BaseModel

from app.config import get_settings
from app.core.gemini import Attachment, generate_structured_with_model

from . import llm_calls
from .exceptions import InvalidRecommendationError

RECOMMENDATIONS = ("APPROVE", "REJECT", "MANUAL_REVIEW")

_DECISION_RULES = """
You are evaluating an Incomplete Exam request for a university student, using ONLY
the evidence provided below. Do not invent, assume, or infer any fact that is not
present in the evidence.

IMPORTANT -- proof must be an actual reviewed document, not just a text claim:
The evidence includes checks.proof.file_attached (true/false). A text description in
Proof (e.g. "police report submitted") is NOT itself verifiable evidence -- it is only
what the student or staff typed. Only treat proof as actually verified if
file_attached is true AND the attached document was reviewed below and found
genuinely consistent with the stated reason. If file_attached is false, the proof
claim is unverified, no matter how plausible the text sounds.

Recommend APPROVE only if all of the following hold:
- The student was verifiably enrolled in the referenced course/section/term
- The request was filed within the allowed submission window
- file_attached is true, and the attached document was reviewed and found genuinely
  consistent with the stated reason and an acceptable proof category
- The stated reason is clearly NOT one of the explicitly invalid categories listed
- The exam type is not a confirmed-excluded type

Recommend REJECT if any of the above is verifiably and clearly failed -- for example,
the request was filed after the submission window, the stated reason clearly and
unambiguously matches an explicitly invalid category (misreading the exam schedule,
personal travel, or a standard job obligation), the exam type is confirmed excluded,
or an attached document is inconsistent with the claim or explicitly states it is not
a real record (e.g. sample or test data).

Recommend MANUAL_REVIEW if anything needed to decide is missing, unclear, ambiguous,
or could not be verified -- including: no enrollment record found; file_attached is
false, meaning a reason was stated but no actual document exists to verify it
against; a borderline or ambiguous stated reason; or the excluded-exam-type list not
yet being confirmed. Never guess when evidence is incomplete or unclear;
MANUAL_REVIEW exists specifically for that situation.
"""

_ATTACHMENT_INSTRUCTIONS = """
One or more supporting documents have been attached below (after the evidence). Look
at them directly as part of your proof and reason-validity assessment -- for example,
whether a document appears consistent with the stated reason (a medical/police
document for an accident claim, a travel document for a travel claim), and whether it
looks like a genuine document of that type. You cannot verify an issuing
authority's authenticity with certainty from an image or PDF alone -- if the
attachment is illegible, inconclusive, or you are not confident it is genuine, say so
plainly in your proof/reason_validity explanations rather than treating it as
confirmed proof. A file being attached is NECESSARY but not SUFFICIENT for APPROVE --
do not upgrade the recommendation to APPROVE purely because a file was attached; the
same MANUAL_REVIEW and REJECT rules above still apply based on what the document
actually shows.
"""


class _IncompleteExamDecision(BaseModel):
    recommendation: str
    reasoning: str
    enrollment_explanation: str
    submission_window_explanation: str
    proof_explanation: str
    reason_validity_explanation: str
    exam_type_explanation: str


def gemini_evidence(evidence_package: dict) -> dict:
    """The evidence Gemini sees: everything except the student's identity (the
    "student" entry and the Student_ID in the enrolment record)."""
    view = {key: value for key, value in evidence_package.items() if key != "student"}
    checks = dict(view.get("checks") or {})
    enrollment = dict(checks.get("enrollment") or {})
    if isinstance(enrollment.get("record"), dict):
        enrollment["record"] = {k: v for k, v in enrollment["record"].items() if k != "Student_ID"}
        checks["enrollment"] = enrollment
        view["checks"] = checks
    return view


def build_prompt(evidence_package: dict, has_attachments: bool) -> str:
    rules = _DECISION_RULES + (_ATTACHMENT_INSTRUCTIONS if has_attachments else "")
    return rules + "\n\nEvidence:\n" + json.dumps(gemini_evidence(evidence_package), indent=2, default=str)


def get_gemini_decision(evidence_package: dict, attachments: list[dict] | None = None) -> dict:
    """{recommendation, reasoning, checks, status 'ok', error None, model}.

    `attachments`: the proof documents ({"filename", "mime_type", "data"}).
    Raises app.core.gemini.GeminiUnavailableError when Gemini cannot produce a
    usable reply on any configured model, and InvalidRecommendationError for a
    recommendation outside APPROVE / REJECT / MANUAL_REVIEW."""
    settings = get_settings()
    parts = [Attachment(mime_type=a["mime_type"], data=a["data"]) for a in attachments or []]
    decision, model = generate_structured_with_model(
        build_prompt(evidence_package, bool(parts)),
        _IncompleteExamDecision,
        model=settings.gemini_model,
        fallback_models=settings.gemini_fallback_models,
        attachments=parts,
        context=f"incomplete exam {evidence_package.get('request_id')}",
    )
    if decision.recommendation not in RECOMMENDATIONS:
        raise InvalidRecommendationError(
            "Gemini returned an unsupported recommendation (expected APPROVE, REJECT or MANUAL_REVIEW)."
        )
    llm_calls.record("eligibility", model)
    return {
        "recommendation": decision.recommendation,
        "reasoning": decision.reasoning,
        "checks": {
            "enrollment": decision.enrollment_explanation,
            "submission_window": decision.submission_window_explanation,
            "proof": decision.proof_explanation,
            "reason_validity": decision.reason_validity_explanation,
            "exam_type": decision.exam_type_explanation,
        },
        "status": "ok",
        "error": None,
        "model": model,
    }

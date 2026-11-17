"""Output safeguard for the Course Equivalency agents.

Gemini never receives the student's identity (gemini_calls.gemini_evidence), but syllabus
text and its own wording could still carry contact details or student numbers. Applied to
Gemini-GENERATED text only -- never to the recommendation, the verified constraints or the
evidence:
- eligibility reasoning, per-check explanations and the major similarities / differences:
  e-mail addresses become "[email]" and UoS student numbers "[student ID]";
- suggested rejection reasons (student-facing) that contain an e-mail address or a UoS
  student number are dropped; if none remain, the agent's own template reasons (built only
  from the verified keywords) are used. The conflict notes are cleaned.
Only counts are recorded; the original text is not kept.
"""

import re

from .rejection import template_reasons

_UOS_ID = re.compile(r"\bU\d{7,9}\b")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


def _clean(text):
    if not isinstance(text, str):
        return text, 0
    out, n1 = _EMAIL.subn("[email]", text)
    out, n2 = _UOS_ID.subn("[student ID]", out)
    return out, n1 + n2


def _has_identity(text) -> bool:
    return isinstance(text, str) and bool(_EMAIL.search(text) or _UOS_ID.search(text))


def clean_eligibility(result: dict) -> tuple[dict, int]:
    changed = 0
    result["reasoning"], n = _clean(result.get("reasoning"))
    changed += n
    for check in result.get("checks") or []:
        check["explanation"], n = _clean(check.get("explanation"))
        changed += n
    for key in ("major_similarities", "major_differences"):
        cleaned = []
        for item in result.get(key) or []:
            item, n = _clean(item)
            changed += n
            cleaned.append(item)
        result[key] = cleaned
    return result, changed


def check_rejection(res: dict) -> tuple[dict, int]:
    dropped = 0
    notes = []
    for note in res.get("notes") or []:
        note, _ = _clean(note)
        notes.append(note)
    res["notes"] = notes
    reasons = res.get("suggested_reasons") or []
    kept = [r for r in reasons if not _has_identity(r.get("text"))]
    dropped = len(reasons) - len(kept)
    if dropped:
        if kept:
            res["suggested_reasons"] = kept
        else:
            verified = {k["id"]: k.get("facts") or {} for k in res.get("keywords") or [] if k.get("type") == "verified"}
            judged = [k["id"] for k in res.get("keywords") or [] if k.get("type") == "judged"]
            res["suggested_reasons"] = template_reasons(verified, judged)
            res["status"] = "fallback"
        res["notes"].append(f"{dropped} suggested reason(s) containing contact details or a student number were removed.")
    return res, dropped

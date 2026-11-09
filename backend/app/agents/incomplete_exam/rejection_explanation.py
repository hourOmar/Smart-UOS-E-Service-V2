"""Rejection Explanation Generator (Agent 6's tool).

Python validates everything Gemini returns: unknown keywords are dropped, reasons that
cite no valid keyword are dropped, and reasons containing a number that is not in the
context are dropped. If nothing usable remains, template reasons built from the
deterministic keywords are used instead."""

import re

from . import rejection_gemini as gemini_service

_NUM = re.compile(r"\d+")


def build_generation_context(result: dict, deterministic: list[dict], options: list[dict]) -> dict:
    evidence = result["evidence"]
    checks = evidence["checks"]
    return {
        "request_id": result.get("request_id") or evidence.get("request_id"),
        "course_id": evidence.get("course_id"),
        "exam_type": (checks.get("exam_type") or {}).get("value"),
        "stated_reason": evidence.get("reason_for_review"),
        "facts": {
            "working_days_elapsed": (checks.get("submission_window") or {}).get("working_days_elapsed"),
            "limit_working_days": (checks.get("submission_window") or {}).get("limit_working_days"),
            "proof_provided": (checks.get("proof") or {}).get("provided"),
            "proof_file_attached": (checks.get("proof") or {}).get("file_attached"),
            "enrollment_found": (checks.get("enrollment") or {}).get("found"),
        },
        "agent5_reasoning": result.get("reasoning"),
        "agent5_check_explanations": result.get("checks"),
        "policy_reference": evidence.get("policy_reference"),
        "deterministic_keywords": deterministic,
        "judgment_keyword_options": options,
    }


def _numbers(obj) -> set[int]:
    return {int(n) for n in _NUM.findall(str(obj))}


def _template_reasons(deterministic: list[dict]) -> list[dict]:
    if not deterministic:
        return []
    text = " ".join(k["plain_reason"] for k in deterministic)
    return [{"tone": "formal", "text": text,
             "addresses_keywords": [k["keyword"] for k in deterministic]}]


def generate_rejection_explanations(result: dict, deterministic: list[dict], options: list[dict]) -> dict:
    context = build_generation_context(result, deterministic, options)
    det_ids = {k["keyword"] for k in deterministic}
    option_ids = {o["keyword"] for o in options}
    valid_ids = det_ids | option_ids

    raw = gemini_service.get_rejection_suggestions(context)
    out = {
        "status": "ok", "gemini_status": raw.get("status"), "gemini_error": raw.get("error"),
        "deterministic_keywords": deterministic, "judgment_keywords": [],
        "suggested_reasons": [], "conflict_note": raw.get("conflict_note") or "",
    }

    if raw.get("status") == "ok":
        chosen = [k for k in raw.get("judgment_keywords", []) if k in option_ids]
        out["judgment_keywords"] = list(dict.fromkeys(chosen))
        allowed_numbers = _numbers(context)
        allowed_ids = det_ids | set(out["judgment_keywords"])
        for r in raw.get("suggested_reasons", []):
            ids = [k for k in r.get("addresses_keywords", []) if k in valid_ids and k in allowed_ids]
            if not ids or not r.get("text", "").strip():
                continue
            if not _numbers(r["text"]) <= allowed_numbers:
                continue
            out["suggested_reasons"].append({**r, "addresses_keywords": ids})
        if out["suggested_reasons"]:
            return out
        out["gemini_error"] = out["gemini_error"] or "No suggested reason passed validation."

    templates = _template_reasons(deterministic)
    if templates:
        out["suggested_reasons"] = templates
        out["status"] = "fallback"
    elif raw.get("status") == "ok":
        out["status"] = "needs_manual_explanation"
    else:
        out["status"] = "unavailable"
    return out

"""Rejection Explanation Agent For Course Equivalency (standalone "Agent 9").

Input: the eligibility agent's result. It only works on REJECT; anything else returns
`not_applicable`. Verified keywords come from code, judged keywords from Gemini's closed
list, and three suggested reasons (formal, concise, supportive) are validated before display.

Statuses: ok | fallback | unavailable | needs_manual_explanation | not_applicable

Unchanged from the standalone rejection_agent.py (explain_rejection_workflow),
tools/explanation_generator.py and tools/rejection_keyword_tools.py; only imports and the
knowledge-file path differ. The command-line report is not ported.
"""

import json
import re
from pathlib import Path

from . import rejection_gemini
from .exceptions import KnowledgeBaseError

_PATH = Path(__file__).resolve().parent / "knowledge_base" / "rejection_keywords.json"

# ---------------------------------------------------------------- explanation generator
_NUM = re.compile(r"\d+(?:\.\d+)?")

_TEMPLATES = {
    "old_course_not_passed": "The course you completed ({course}) does not have a passing grade ({grade}), so it cannot be accepted as equivalent.",
    "grade_below_minimum": "Your grade in the completed course ({grade}) is below the minimum grade of {required_grade} required for equivalency.",
    "course_not_in_study_plan": "The requested course ({course}) is not part of your study plan, so an equivalency cannot be granted for it.",
    "program_change_rejected": "Your program change to {program} was not approved, so you remain in your current program and the requested course is not part of its study plan.",
    "transfer_credit_limit_exceeded": "Approving this request would bring your transferred credit hours to {total_after}, which is above the maximum of {limit}.",
    "similarity_below_threshold": "The syllabus comparison shows {similarity_percent}% similarity between the two courses, which is below the {required_percent}% required for equivalency.",
    "credit_hours_lower": "The course you completed has {completed_credit_hours} credit hours, which is fewer than the {requested_credit_hours} credit hours of the requested course.",
    "level_mismatch": "The course you completed is at the {completed_level}-level, which is lower than the {requested_level}-level of the requested course.",
    "missing_course_topics": "Important topics of the requested course are not covered by the course you completed, including: {topics}.",
}
_JUDGED = {
    "learning_outcomes_gap": "The learning outcomes of the requested course are not fully met by the course you completed.",
    "assessment_structure_differs": "The assessment structure of the two courses differs significantly.",
    "different_course_focus": "The two courses have a different focus.",
    "insufficient_syllabus_detail": "The syllabus does not give enough detail to support equivalency.",
}


def _sentence(key: str, facts: dict) -> str:
    f = dict(facts)
    if "topics" in f:
        f["topics"] = "; ".join(f["topics"])
    return _TEMPLATES[key].format(**f)


def allowed_numbers(context_text: str) -> set[str]:
    return set(_NUM.findall(context_text))


def validate_reasons(reasons: list[dict], valid_keywords: set[str], allowed: set[str]) -> tuple[list[dict], list[str]]:
    kept, dropped = [], []
    for r in reasons:
        kws = [k for k in r.get("addresses_keywords", []) if k in valid_keywords]
        text = (r.get("text") or "").strip()
        if not text or not kws:
            dropped.append("reason without a valid keyword was removed")
            continue
        bad = [n for n in _NUM.findall(text) if n not in allowed]
        if bad:
            dropped.append(f"reason with unverified number(s) {bad} was removed")
            continue
        kept.append({"tone": r.get("tone", "formal"), "text": text, "addresses_keywords": kws})
    return kept, dropped


def template_reasons(verified: dict, judged: list[str]) -> list[dict]:
    parts = [(k, _sentence(k, v)) for k, v in verified.items()] + [(k, _JUDGED[k]) for k in judged if k in _JUDGED]
    if not parts:
        return []
    keys = [k for k, _ in parts]
    body = " ".join(s for _, s in parts)
    first = parts[0][1]
    return [
        {"tone": "formal", "text": f"After reviewing your Course Equivalency request, it cannot be approved. {body}", "addresses_keywords": keys},
        {"tone": "concise", "text": first, "addresses_keywords": [parts[0][0]]},
        {"tone": "supportive", "text": f"Thank you for your request. Unfortunately, it could not be approved at this time. {body} You are welcome to speak with your academic advisor about other options.", "addresses_keywords": keys},
    ]


# ---------------------------------------------------------------- keywords
def load_keywords() -> dict:
    try:
        data = json.loads(_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise KnowledgeBaseError(f"Could not load rejection_keywords.json: {exc}") from exc
    if not isinstance(data.get("verified"), dict) or not isinstance(data.get("judged"), dict):
        raise KnowledgeBaseError("rejection_keywords.json must define 'verified' and 'judged'.")
    return data


def verified_facts(agent8: dict) -> dict:
    """Keyword id -> supporting facts, from code-calculated evidence only."""
    ev = agent8["evidence"]
    old, new, sim = ev["old_course"], ev["new_course"], ev["similarity"]
    found: dict[str, dict] = {}
    cn = ev["constraints"]
    if old["passed"] is False:
        found["old_course_not_passed"] = {"grade": old["grade"], "course": old["name"] or old["course_id"]}
    elif cn["minimum_grade"]["meets"] is False:
        found["grade_below_minimum"] = {"grade": cn["minimum_grade"]["grade"], "required_grade": cn["minimum_grade"]["required"]}
    if cn["study_plan"]["in_plan"] is False:
        found["course_not_in_study_plan"] = {"course": new["name"] or new["course_id"]}
        pcg = cn["study_plan"].get("program_change")
        if pcg and pcg.get("result") == "rejected":
            found["program_change_rejected"] = {"program": pcg["new_program_name"]}
    tl = cn["transfer_limit"]
    if tl["within_limit"] is False:
        found["transfer_credit_limit_exceeded"] = {"total_after": tl["total_after"], "limit": tl["cap_credit_hours"]}
    if sim and sim["score_band"] == "BELOW_RANGE":
        found["similarity_below_threshold"] = {"similarity_percent": sim["overall_similarity_percent"],
                                               "required_percent": sim["thresholds"]["review_min"]}
    elif sim and sim["score_band"] == "REVIEW_RANGE":
        found["similarity_below_threshold"] = {"similarity_percent": sim["overall_similarity_percent"],
                                               "required_percent": sim["thresholds"]["equivalent_min"]}
    if cn["credit_hours"]["old_covers_new"] is False:
        found["credit_hours_lower"] = {"completed_credit_hours": cn["credit_hours"]["old"],
                                       "requested_credit_hours": cn["credit_hours"]["new"]}
    lvl = ev["academic_level"]
    if lvl["old_at_least_new"] is False:
        found["level_mismatch"] = {"completed_level": lvl["old_level"] * 100, "requested_level": lvl["new_level"] * 100}
    if sim and sim["new_topics_not_covered"]:
        found["missing_course_topics"] = {"topics": sim["new_topics_not_covered"][:8], "count": len(sim["new_topics_not_covered"])}
    return found


# ---------------------------------------------------------------- workflow
def explain_rejection_workflow(agent8_result: dict) -> dict:
    base = {"request_id": agent8_result.get("request_id"), "status": "not_applicable", "keywords": [],
            "suggested_reasons": [], "notes": []}
    if agent8_result.get("recommendation") != "REJECT":
        base["notes"].append("The request was not recommended for rejection, so no rejection explanation is needed.")
        return base

    kw = load_keywords()
    verified = verified_facts(agent8_result)
    ev = agent8_result["evidence"]
    sim = ev["similarity"]
    context = {
        "request_id": agent8_result["request_id"],
        "completed_course": ev["old_course"]["name"] or ev["old_course"]["course_id"],
        "requested_course": ev["new_course"]["name"],
        "similarity_percent": sim["overall_similarity_percent"] if sim else None,
        "constraints": ev["constraints"],
        "component_percent": sim["components_percent"] if sim else None,
        "deterministic_keywords": verified,
        "judgment_keyword_options": kw["judged"],
        "eligibility_reasoning": agent8_result.get("reasoning"),
        "major_differences": agent8_result.get("major_differences"),
        "check_explanations": agent8_result.get("checks"),
    }
    suggestions = rejection_gemini.get_rejection_suggestions(context)
    judged = [k for k in suggestions["judgment_keywords"] if k in kw["judged"]]
    if suggestions["conflict_note"]:
        base["notes"].append(f"Conflict noted: {suggestions['conflict_note']}")

    if not verified and not judged:
        base.update(status="needs_manual_explanation")
        base["notes"].append("No rejection keyword could be verified from the evidence. The staff member should write the explanation.")
        return base

    valid = set(verified) | set(judged)
    kept, dropped = ([], []) if suggestions["status"] != "ok" else validate_reasons(
        suggestions["suggested_reasons"], valid, allowed_numbers(json.dumps(context, default=str)))
    base["notes"].extend(dropped)
    if suggestions["status"] == "ok" and kept:
        base.update(status="ok", suggested_reasons=kept)
    else:
        base.update(status="unavailable" if suggestions["status"] == "unavailable" else "fallback",
                    suggested_reasons=template_reasons(verified, judged))
        if suggestions["error"]:
            base["notes"].append(f"Gemini: {suggestions['error']}")
    base["keywords"] = [{"id": k, "type": "verified", "description": kw["verified"][k], "facts": v} for k, v in verified.items()] + \
                       [{"id": k, "type": "judged", "description": kw["judged"][k]} for k in judged]
    return base

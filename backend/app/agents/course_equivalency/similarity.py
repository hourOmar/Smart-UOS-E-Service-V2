"""Syllabus comparison tools: Gemini only says which items match; the percentages and the
overall similarity score are calculated here, with the weights in
knowledge_base/equivalency_policy.json.

Direction: the completed (old) course must cover the requested (new) course, so coverage is
measured over the NEW course's topics and learning outcomes.

Unchanged from the standalone tools/syllabus_tools.py (compute_similarity, _coverage,
_assessment_similarity, text_overlap_percent, syllabus_request_message), except that the
syllabus request names the formats the upload service accepts (PDF or DOCX; TXT is not
accepted there) and asks for an upload without naming who uploads. Syllabus retrieval
moved to syllabus_files.py.
"""

import math
import re
from collections import Counter


def syllabus_request_message(syllabi: dict) -> str | None:
    """What to ask for, when a syllabus is missing or unreadable."""
    needed = [("old", "previously completed course"), ("new", "requested course")]
    missing = [label for s, label in needed if not syllabi[s]["readable"]]
    if not missing:
        return None
    return "Upload a readable syllabus (PDF or DOCX) for the " + " and the ".join(missing) + "."


def text_overlap_percent(a: str, b: str) -> float:
    """Plain word-count cosine similarity. A rough baseline used as supporting evidence only."""
    def vec(t):
        return Counter(w for w in re.findall(r"[a-z]{3,}", t.lower()))
    va, vb = vec(a), vec(b)
    dot = sum(va[w] * vb[w] for w in va)
    na, nb = math.sqrt(sum(v * v for v in va.values())), math.sqrt(sum(v * v for v in vb.values()))
    return round(100 * dot / (na * nb), 1) if na and nb else 0.0


def _coverage(n_new: int, matches: list[dict], partial_weight: float) -> tuple[float | None, list[int]]:
    """Percentage of the new course's items covered by the old course, plus the uncovered indexes."""
    if n_new == 0:
        return None, []
    best: dict[int, float] = {}
    for m in matches:
        ni, oi = m.get("new_index"), m.get("old_index")
        if not isinstance(ni, int) or not isinstance(oi, int) or not 0 <= ni < n_new:
            continue
        w = 1.0 if m.get("strength") == "full" else partial_weight
        best[ni] = max(best.get(ni, 0.0), w)
    covered = sum(best.values())
    uncovered = [i for i in range(n_new) if i not in best]
    return round(100 * covered / n_new, 1), uncovered


def _assessment_similarity(a: dict | None, b: dict | None, categories: list[str]) -> float | None:
    def norm(d):
        vals = {c: float((d or {}).get(c) or 0) for c in categories}
        total = sum(vals.values())
        return {c: 100 * v / total for c, v in vals.items()} if total > 0 else None
    na, nb = norm(a), norm(b)
    if na is None or nb is None:
        return None
    return round(100 - sum(abs(na[c] - nb[c]) for c in categories) / 2, 1)


def compute_similarity(analysis: dict, old_credits, new_credits, policy: dict) -> dict:
    """Deterministic scoring of Gemini's structured comparison."""
    old, new = analysis["old"], analysis["new"]
    pw = policy.get("partial_match_weight", 0.5)
    topics_pct, topics_missing = _coverage(len(new["topics"]), analysis.get("topic_matches", []), pw)
    outcomes_pct, outcomes_missing = _coverage(len(new["learning_outcomes"]), analysis.get("outcome_matches", []), pw)
    assess = _assessment_similarity(old.get("assessment"), new.get("assessment"), policy["assessment_categories"])

    oc = old_credits if old_credits is not None else old.get("credit_hours")
    nc = new_credits if new_credits is not None else new.get("credit_hours")
    credit_pct = round(100 * min(oc / nc, 1.0), 1) if oc and nc else None
    credit_note = None
    for label, db, doc in (("old", old_credits, old.get("credit_hours")), ("new", new_credits, new.get("credit_hours"))):
        if db is not None and doc is not None and db != doc:
            credit_note = f"The {label} syllabus states {doc} credit hours but the catalog says {db}."

    components = {"topics": topics_pct, "learning_outcomes": outcomes_pct, "assessment_structure": assess, "credit_hours": credit_pct}
    weights = policy["weights"]
    used = {k: v for k, v in components.items() if v is not None}
    total_w = sum(weights[k] for k in used)
    overall = round(sum(weights[k] * v for k, v in used.items()) / total_w, 1) if used and topics_pct is not None and total_w else None

    t = policy["similarity_thresholds"]
    band = None if overall is None else ("EQUIVALENT_RANGE" if overall >= t["equivalent_min"]
                                         else "REVIEW_RANGE" if overall >= t["review_min"] else "BELOW_RANGE")
    ver = analysis.get("verification")
    limit = policy.get("max_unverified_match_percent", 30)
    return {
        "match_verification": ver,
        "verification_ok": None if ver is None else ver["dropped_percent"] <= limit,
        "overall_similarity_percent": overall,
        "score_band": band,
        "thresholds": t,
        "components_percent": components,
        "credit_hours": {"old": oc, "new": nc, "old_covers_new": (oc >= nc) if oc and nc else None, "note": credit_note},
        "new_topics_not_covered": [new["topics"][i] for i in topics_missing],
        "new_outcomes_not_covered": [new["learning_outcomes"][i] for i in outcomes_missing],
        "topics_counts": {"old": len(old["topics"]), "new": len(new["topics"])},
    }

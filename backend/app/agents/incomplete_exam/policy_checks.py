"""Evaluates an Incomplete_Exam request against the approved incomplete-exam policy
(app/knowledge_base/incomplete_exam_policy.json).

Deliberately narrow scope: this only checks what can be verified from the database
alone -- the submission-window deadline and whether any proof was provided at all.

What it does NOT decide, and why:
- Whether the proof is actually a valid, authenticated medical report, or a genuine
  IT-helpline-verified outage report -- the database only stores free text/a file
  reference in Proof, not a verification status. Deciding "is this proof legitimate"
  from that text is exactly the kind of judgment call that belongs to Gemini (given
  the raw Reason/Proof text plus the policy's stated categories), not something Python
  should fake a verdict on.
- Whether the stated Reason falls into an explicitly invalid category (misread
  schedule, personal travel, standard job obligations). Keyword-matching free text in
  Python is unreliable and risks false positives/negatives. Instead, the raw Reason
  and the policy's list of invalid categories are both included in the evidence
  package, and Gemini -- which is meant to work from exactly this kind of unstructured
  text -- makes that judgment (see the decision rules in app/services/gemini.py).

Field names below (Missed_Exam_Date, Reason, Proof, Exam_Type, Course_ID, Section_ID,
Term) match the live "Incomplete_Exam" table; Request_Date matches "Request". If
request_tools.py ends up returning a joined dict under different keys, update the
lookups below to match -- the logic itself does not need to change.
"""

from datetime import date, datetime, timedelta
from pathlib import Path
import json


_POLICY_PATH = Path(__file__).resolve().parent / "knowledge_base" / "incomplete_exam_policy.json"

_WEEKDAY_MAP = {
    "Monday": 0, "Tuesday": 1, "Wednesday": 2, "Thursday": 3,
    "Friday": 4, "Saturday": 5, "Sunday": 6,
}


def get_incomplete_exam_policy() -> dict:
    """Loads app/knowledge_base/incomplete_exam_policy.json."""
    with open(_POLICY_PATH, encoding="utf-8") as f:
        return json.load(f)


def _working_days_between(start: date, end: date, weekend_days: list[str]) -> int:
    """Counts working days strictly between two dates, excluding the configured
    weekend days (Friday/Saturday for UAE, per the policy). Does not exclude public
    holidays -- there is no holiday calendar in the current schema to check against,
    so a request submitted just after a public holiday could be flagged as late when
    it shouldn't be. This is a known, accepted limitation, not something silently
    ignored -- it's surfaced in the returned evidence (see "holiday_calendar_checked").
    """
    excluded = {_WEEKDAY_MAP[d] for d in weekend_days}
    days = 0
    current = start
    while current < end:
        current += timedelta(days=1)
        if current.weekday() not in excluded:
            days += 1
    return days


def _coerce_date(value) -> date:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value).date()
    raise TypeError(f"Cannot interpret {value!r} as a date")


def evaluate_incomplete_exam_request(request: dict, policy: dict) -> dict:
    """Returns the deterministic evidence only. Reason-category and
    proof-authenticity judgment are deliberately left OUT of this return value (see
    module docstring) -- app/agent.py should pass request["Reason"], request["Proof"],
    and request["Exam_Type"] to Gemini directly, alongside
    policy["acceptable_proof_categories"] and policy["explicitly_invalid_reasons"],
    rather than this function pre-judging them.
    """
    window = policy["submission_window"]
    missed_date = _coerce_date(request["Missed_Exam_Date"])
    request_date = _coerce_date(request["Request_Date"])

    days_elapsed = _working_days_between(missed_date, request_date, window["weekend_days"])
    within_window = days_elapsed <= window["limit_working_days"]

    proof_value = (request.get("Proof") or "").strip()
    proof_provided = bool(proof_value) if policy["proof_required"] else None

    exam_type = request.get("Exam_Type")
    excluded_config = policy.get("excluded_exam_types", {})
    excluded_types = excluded_config.get("values", [])
    # Confirmed status means "checked, and this list is complete" -- which is true
    # even when the list is empty (e.g. this university has no excluded exam type
    # category at all). An unconfirmed status means "never actually checked", which
    # must stay unresolved (None) regardless of whether the list happens to be empty.
    is_confirmed = excluded_config.get("status") == "confirmed"
    exam_type_excluded = (exam_type in excluded_types) if is_confirmed else None

    return {
        "submission_window": {
            "missed_exam_date": missed_date.isoformat(),
            "request_date": request_date.isoformat(),
            "working_days_elapsed": days_elapsed,
            "limit_working_days": window["limit_working_days"],
            "satisfied": within_window,
            "holiday_calendar_checked": False,
        },
        "proof": {
            "required": policy["proof_required"],
            "provided": proof_provided,
            "raw_value": proof_value or None,
        },
        "exam_type": {
            "value": exam_type,
            "excluded_values_confirmed": is_confirmed,
            "excluded": exam_type_excluded,
        },
        # Passed through as-is for Gemini to weigh -- not evaluated here.
        # Description is the primary source of the student's actual explanation
        # (confirmed against real data: Incomplete_Exam.Reason is optional and often
        # empty in practice, while Request.Description holds the real narrative).
        # Reason is kept as a fallback/supplement in case Description is ever blank.
        "reason_for_gemini_review": request.get("Description") or request.get("Reason"),
        "acceptable_proof_categories": policy.get("acceptable_proof_categories", []),
        "explicitly_invalid_reasons": policy.get("explicitly_invalid_reasons", []),
    }

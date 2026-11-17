"""Gemini layer of the Course Equivalency eligibility agent.

Two separate calls, neither with tool access:
  1. analyze_syllabi  -- reads BOTH syllabi, extracts topics / learning outcomes / credit
                         hours / assessment structure, and says which items of the requested
                         course are covered by the completed course (with verbatim quotes that
                         match_verifier checks in the text). Python computes the percentages.
  2. get_gemini_decision -- receives the evidence package and the decision rules and returns
                         APPROVE / REJECT / MANUAL_REVIEW with reasoning.

Unchanged from the standalone services/gemini.py: _ANALYSIS_RULES, _DECISION_RULES, the reply
schemas, the prompt contents, the system instructions, temperature 0.0 and the result shapes.
Changes (see __init__): the calls go through app.core.gemini with the configured fallback
models; a failure raises GeminiUnavailableError instead of returning a MANUAL_REVIEW result;
the decision call receives gemini_evidence(...) -- the evidence without the student's
identity, CGPA, completed hours, the free-text reason, the Program Change request ID and
syllabus file names.
"""

import copy
import json
from typing import Literal

from pydantic import BaseModel

from app.config import get_settings
from app.core.gemini import generate_structured_with_model

from . import llm_calls
from .match_verifier import verify_matches


class _Assessment(BaseModel):
    exams: float | None = None
    quizzes: float | None = None
    assignments: float | None = None
    projects: float | None = None
    labs: float | None = None
    participation: float | None = None
    other: float | None = None


class _CourseInfo(BaseModel):
    title: str
    credit_hours: int | None = None
    topics: list[str]
    learning_outcomes: list[str]
    assessment: _Assessment


class _Match(BaseModel):
    new_index: int
    old_index: int
    strength: Literal["full", "partial"]
    old_quote: str  # exact text copied from the OLD syllabus that shows the old course covers the item
    new_quote: str  # exact text copied from the NEW syllabus where the item is listed


class _SyllabusAnalysis(BaseModel):
    old: _CourseInfo
    new: _CourseInfo
    topic_matches: list[_Match]
    outcome_matches: list[_Match]


class _Check(BaseModel):
    name: str
    status: Literal["PASS", "FAIL", "N/A"]
    explanation: str


class _Decision(BaseModel):
    recommendation: Literal["APPROVE", "REJECT", "MANUAL_REVIEW"]
    reasoning: str
    checks: list[_Check]
    major_similarities: list[str]
    major_differences: list[str]


_ANALYSIS_RULES = """You compare two university course syllabi for a course equivalency request.
OLD = the course the student already completed. NEW = the course the student wants it to count for.

Rules:
1. Use ONLY the text of the two syllabi. Never invent topics, outcomes, credit hours or percentages.
2. For each course extract: title, credit hours (null if not stated), a list of distinct topics
   (short phrases, weekly schedule items merged into topics), a list of learning outcomes
   (short phrases), and the assessment weights in percent per category (exams, quizzes,
   assignments, projects, labs, participation, other; null when not stated).
3. topic_matches: for every NEW topic that the OLD course covers, give new_index (position in
   NEW topics), old_index (position in OLD topics) and strength: "full" when the OLD topic
   covers it at the same depth, "partial" when it is only touched on or covered at lower depth.
   Do not list NEW topics the OLD course does not cover.
4. outcome_matches: the same, for learning outcomes.
5. Indexes start at 0 and must refer to the lists you return.
6. EVIDENCE: every match must include old_quote and new_quote. Each is a short piece of text (at least
   one full phrase or line, copied CHARACTER FOR CHARACTER from the syllabus text above, never your own
   topic label, never paraphrased or translated; prefer the whole line or sentence of the syllabus) taken from the OLD syllabus (old_quote) and the NEW syllabus (new_quote). The quotes are
   checked by code; a match whose quote cannot be found in the document is discarded. If you cannot
   quote the OLD syllabus for a topic, do not list it as a match.
"""

_DECISION_RULES = """You are the decision layer of a Course Equivalency eligibility agent. You receive a
verified evidence package. Recommend whether the previously completed course (old) can be accepted
as equivalent to the requested course (new). The HOD makes the final decision; you only recommend.

Rules:
1. Use ONLY the evidence package. Never invent grades, topics, numbers or policy.
2. Hard constraints (from the university's course equivalency rules). If any is verified as not
   met, recommend REJECT:
   a. constraints.minimum_grade.meets is false (the completed course needs at least a C+);
   b. constraints.study_plan.in_plan is false (the requested course must be in the study plan of the
      program in study_plan.program_checked; after an approved program change that is the new program);
   c. constraints.credit_hours.old_covers_new is false (the completed course must have credit hours
      equal to or greater than the requested course);
   d. constraints.transfer_limit.within_limit is false (total transferred credits would exceed the limit).
   A study_plan.program_change with result "rejected" means the student stays in the current
   program; it is a reason for the study-plan failure, not a pending matter.
3. If a hard constraint is unverified (its value is null; for the study plan this includes a program
   change that is still pending, explained in study_plan.note), or the old course grade is missing, recommend
   MANUAL_REVIEW and say what could not be verified. Unverified is not a failure.
4. If a syllabus is missing or unreadable (syllabi.*.readable is false), or the similarity score is
   null -> MANUAL_REVIEW and repeat syllabus_request in your reasoning. Never guess content.
5. When all hard constraints are met and a score exists, use overall_similarity_percent against the
   thresholds: at or above equivalent_min -> APPROVE is expected; at or above review_min but below
   equivalent_min -> MANUAL_REVIEW; below review_min -> REJECT. You may move one step toward
   MANUAL_REVIEW (never toward APPROVE) when the evidence shows a serious problem such as a lower
   academic level or large uncovered core topics, and you must say why.
6. If old_course.grade_source is "request", the grade was stated in the request and is not confirmed by
   a transcript; say so in your reasoning.
7. Return checks named: minimum_grade, study_plan, credit_hours, transfer_credit_limit,
   syllabi_available, content_similarity, academic_level. Use status N/A when it does not apply or
   cannot be verified.
8. major_similarities and major_differences: short, specific items taken from the evidence
   (for example uncovered topics from new_topics_not_covered). Use empty lists if there are none.
9. reasoning: 2 to 4 sentences, plain language, mention the similarity percentage when present.
"""

ANALYSIS_TEMPERATURE = 0.0
DECISION_TEMPERATURE = 0.0

# What Gemini never receives (approved Phase 4 decision 8).
_STUDENT_KEYS_SENT = ("program_id", "program_name")
_REQUEST_KEYS_WITHHELD = ("reason",)
_CONTEXT_KEYS_WITHHELD = ("Program_Change_Request_ID",)
_SYLLABUS_KEYS_WITHHELD = ("filename", "files")


def gemini_evidence(evidence_package: dict) -> dict:
    """The evidence the decision call sees: no student name / ID / CGPA / completed hours,
    no free-text reason, no Program Change request ID, no syllabus file names."""
    view = copy.deepcopy(evidence_package)
    student = view.get("student") or {}
    view["student"] = {k: student.get(k) for k in _STUDENT_KEYS_SENT}
    request = view.get("request") or {}
    for key in _REQUEST_KEYS_WITHHELD:
        request.pop(key, None)
    extra = request.get("other_request_fields") or {}
    for key in _CONTEXT_KEYS_WITHHELD:
        extra.pop(key, None)
    for side in (view.get("syllabi") or {}).values():
        for key in _SYLLABUS_KEYS_WITHHELD:
            side.pop(key, None)
    return view


def _models():
    settings = get_settings()
    return settings.gemini_model, settings.gemini_fallback_models


def analyze_syllabi(old_text: str, new_text: str, request_id: str = "") -> dict:
    """{"status": "ok", "error": None, "analysis": verified analysis, "model"}.
    Raises GeminiUnavailableError when no configured model produces a usable reply."""
    model, fallbacks = _models()
    prompt = f"=== OLD COURSE SYLLABUS ===\n{old_text}\n\n=== NEW COURSE SYLLABUS ===\n{new_text}"
    parsed, answered = generate_structured_with_model(
        prompt, _SyllabusAnalysis, model=model, fallback_models=fallbacks, system_instruction=_ANALYSIS_RULES,
        temperature=ANALYSIS_TEMPERATURE, context=f"course equivalency syllabus analysis {request_id}",
    )
    llm_calls.record("syllabus_analysis", answered)
    return {"status": "ok", "error": None, "analysis": verify_matches(parsed.model_dump(), old_text, new_text),
            "model": answered}


def get_gemini_decision(evidence_package: dict) -> dict:
    """The standalone decision result shape with status "ok". Raises GeminiUnavailableError
    when no configured model produces a usable reply."""
    model, fallbacks = _models()
    parsed, answered = generate_structured_with_model(
        json.dumps(gemini_evidence(evidence_package), indent=2, default=str), _Decision, model=model,
        fallback_models=fallbacks, system_instruction=_DECISION_RULES, temperature=DECISION_TEMPERATURE,
        context=f"course equivalency decision {evidence_package.get('request', {}).get('request_id', '')}",
    )
    llm_calls.record("decision", answered)
    return {"status": "ok", "error": None, "recommendation": parsed.recommendation, "reasoning": parsed.reasoning,
            "checks": [c.model_dump() for c in parsed.checks], "major_similarities": list(parsed.major_similarities),
            "major_differences": list(parsed.major_differences), "model": answered}

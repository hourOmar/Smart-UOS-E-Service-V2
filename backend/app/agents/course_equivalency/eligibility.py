"""Academic Eligibility Evaluation Agent For Course Equivalency (standalone "Agent 8").

Python gathers and computes verified evidence; Gemini recommends; the HOD/administrator decides.

    request details -> student and transcript -> old / new course -> was the old course passed
    -> the two syllabi -> Gemini extracts and matches them (quotes verified by code)
    -> Python calculates the similarity score -> Gemini recommends from the evidence and rules
    -> guardrails keep an unsafe APPROVE from going out

Unchanged from the standalone agent.py: _LABELS, _level_evidence, the body of _constraints,
_apply_guardrails, the evidence package keys and the result shape. Changes (see __init__):
the inputs come from request_data / syllabus_files (no database or Storage access here); the
transcript attempt is the best one; a Gemini failure raises (GeminiUnavailableError) instead
of producing MANUAL_REVIEW, so the "AI service could not produce a recommendation" branch of
_apply_guardrails is kept but no longer reached.
"""

from . import gemini_calls
from .plan_tools import transfer_limit
from .policy import classify_grade, load_equivalency_policy, load_grade_required, meets_minimum_grade
from .request_data import CourseEquivalencyData, find_course_in_transcript
from .similarity import compute_similarity, syllabus_request_message, text_overlap_percent

_LABELS = {"APPROVE": "EQUIVALENT", "REJECT": "NON_EQUIVALENT", "MANUAL_REVIEW": "FURTHER_REVIEW"}


def _level_evidence(courses: dict) -> dict:
    o, n = courses["old"]["level"], courses["new"]["level"]
    return {"old_level": o, "new_level": n, "old_at_least_new": (o >= n) if o is not None and n is not None else None}


def _constraints(courses: dict, grade, similarity, policy: dict, data: CourseEquivalencyData) -> dict:
    """The university's course equivalency constraints, each verified by code. None = could not be verified.
    The study plan, the program used and the transferred credits were resolved by request_data
    (the standalone resolved them here, with the same functions)."""
    old_c, new_c = courses["old"]["credit_hours"], courses["new"]["credit_hours"]
    if similarity:
        old_c, new_c = similarity["credit_hours"]["old"], similarity["credit_hours"]["new"]
    plan = data.study_plan
    program = data.program_info
    lim = transfer_limit(program["college"], program["plan_total_credits"])
    already = data.transferred
    total_after = already + new_c if new_c else None
    if total_after is None:
        within = None
    elif total_after <= 60 or lim["college_known"]:
        within = total_after <= lim["cap_credit_hours"]
    else:  # above 60 and the college (60 or 70 hour limit) is unknown
        within = False if total_after > 70 else None
    return {
        "minimum_grade": {"required": load_grade_required(), "grade": grade, "meets": meets_minimum_grade(grade)},
        "study_plan": {"program_checked": plan.get("program_checked"), "in_plan": plan["in_plan"], "note": plan["note"],
                       "program_change": plan.get("program_change")},
        "credit_hours": {"old": old_c, "new": new_c, "old_covers_new": (old_c >= new_c) if old_c and new_c else None},
        "transfer_limit": {"already_transferred": already, "this_request_adds": new_c, "total_after": total_after,
                           "cap_credit_hours": lim["cap_credit_hours"], "college": lim["college"], "within_limit": within,
                           "note": lim["community_college_note"]},
        "gpa_impact": policy["constraints"]["gpa_impact"],
    }


def build_evidence_package(request_id: str, data: CourseEquivalencyData, syllabi: dict) -> dict:
    """Collects and computes all deterministic evidence (plus Gemini's syllabus matching,
    which is converted to numbers by Python). Does NOT decide a recommendation.
    `syllabi`: syllabus_files.SyllabusLoad.sides (text in memory only)."""
    policy = load_equivalency_policy()
    request = data.request
    student = data.student
    courses = data.courses
    old_in_transcript = find_course_in_transcript(data.transcript, request["old_course_id"])
    grade, grade_source = old_in_transcript["grade"], "transcript"
    if grade is None and request.get("stated_grade"):
        grade, grade_source = request["stated_grade"], "request"
    elif grade is None:
        grade_source = None

    syllabus_request = syllabus_request_message(syllabi)

    analysis_status, analysis_error, similarity, overlap = "skipped", None, None, None
    if syllabus_request is None:
        res = gemini_calls.analyze_syllabi(syllabi["old"]["text"], syllabi["new"]["text"], request_id)
        analysis_status, analysis_error = res["status"], res["error"]
        overlap = text_overlap_percent(syllabi["old"]["text"], syllabi["new"]["text"])
        if res["analysis"] is not None:
            similarity = compute_similarity(res["analysis"], courses["old"]["credit_hours"], courses["new"]["credit_hours"], policy)
            similarity["extracted"] = {k: {"title": res["analysis"][k]["title"], "credit_hours": res["analysis"][k]["credit_hours"]}
                                       for k in ("old", "new")}

    constraints = _constraints(courses, grade, similarity, policy, data)

    return {
        "request": {"request_id": request_id, "reason": request["reason"], "request_date": request["request_date"],
                    "other_request_fields": request.get("extra_fields") or {}},
        "student": student,
        "old_course": {**courses["old"], "in_transcript": old_in_transcript["found"], "grade": grade, "grade_source": grade_source,
                       "passed": classify_grade(grade) if grade is not None else None, "term": old_in_transcript["term"]},
        "constraints": constraints,
        "new_course": courses["new"],
        "academic_level": _level_evidence(courses),
        "syllabi": {s: {k: syllabi[s][k] for k in ("available", "readable", "source", "filename", "file_count", "error")} for s in ("old", "new")},
        "syllabus_request": syllabus_request,
        "syllabus_analysis": {"status": analysis_status, "error": analysis_error},
        "similarity": similarity,
        "text_overlap_percent": overlap,
    }


def _apply_guardrails(evidence: dict, g: dict) -> dict:
    """Deterministic safety net for the university's hard constraints. A verified violation forces
    REJECT; an unverified constraint blocks APPROVE. It never makes the outcome less cautious."""
    rec, notes = g["recommendation"], []
    c, sim = evidence["constraints"], evidence["similarity"]
    if g["status"] != "ok":
        rec = "MANUAL_REVIEW"
        g["reasoning"] = (f"The AI service could not produce a recommendation ({g['error']}). "
                          "The collected evidence is attached for manual review.")
    violations = []
    if c["minimum_grade"]["meets"] is False:
        violations.append(f"the completed course grade ({c['minimum_grade']['grade']}) is below the required minimum of {c['minimum_grade']['required']}")
    if c["study_plan"]["in_plan"] is False:
        violations.append("the requested course is not in the student's study plan")
    if c["credit_hours"]["old_covers_new"] is False:
        violations.append(f"the completed course has {c['credit_hours']['old']} credit hours, fewer than the {c['credit_hours']['new']} of the requested course")
    if c["transfer_limit"]["within_limit"] is False:
        violations.append(f"the transfer would bring the total to {c['transfer_limit']['total_after']} credit hours, above the {c['transfer_limit']['cap_credit_hours']} limit")
    if violations:
        if rec != "REJECT":
            notes.append("This request cannot be accepted because " + "; ".join(violations) + ".")
        rec = "REJECT"
    elif rec == "APPROVE":
        unverified = [n for n, v in (("minimum grade", c["minimum_grade"]["meets"]), ("study plan", c["study_plan"]["in_plan"]),
                                     ("transfer credit limit", c["transfer_limit"]["within_limit"]),
                                     ("credit hours", c["credit_hours"]["old_covers_new"])) if v is not True]
        if unverified:
            rec = "MANUAL_REVIEW"
            notes.append("Automatic approval was withheld because these could not be verified: " + ", ".join(unverified) + ".")
        elif sim and sim.get("verification_ok") is False:
            rec = "MANUAL_REVIEW"
            notes.append("Automatic approval was withheld because many of the AI's topic matches could not be confirmed in the syllabus text.")
        elif sim is None or sim["score_band"] != "EQUIVALENT_RANGE":
            rec = "MANUAL_REVIEW"
            notes.append("Automatic approval was withheld because the similarity score does not meet the approval threshold.")
    if notes:
        g["reasoning"] = (g["reasoning"] + " " + " ".join(notes)).strip()
    g["recommendation"] = rec
    return g


def evaluate_course_equivalency_request(request_id: str, data: CourseEquivalencyData, syllabi: dict) -> dict:
    """The standalone evaluate_course_equivalency_request result. Raises
    GeminiUnavailableError when Gemini cannot analyse or decide (a technical failure)."""
    evidence = build_evidence_package(request_id, data, syllabi)
    gemini = gemini_calls.get_gemini_decision(evidence)
    models = {"decision": gemini.pop("model", None)}
    gemini = _apply_guardrails(evidence, gemini)
    return {
        "request_id": request_id,
        "evidence": evidence,
        "recommendation": gemini["recommendation"],
        "equivalency_label": _LABELS[gemini["recommendation"]],
        "reasoning": gemini["reasoning"],
        "checks": gemini["checks"],
        "major_similarities": gemini["major_similarities"],
        "major_differences": gemini["major_differences"],
        "syllabus_request": evidence["syllabus_request"],
        "approval_note": evidence["constraints"]["gpa_impact"] if gemini["recommendation"] == "APPROVE" else None,
        "gemini_status": gemini["status"],
        "gemini_error": gemini["error"],
        "models": models,
    }

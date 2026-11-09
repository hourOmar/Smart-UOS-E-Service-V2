"""Rejection Explanation Agent For Incomplete Exam (Agent 6).

Input : the finished output of Agent 5 (Academic Eligibility Evaluation Agent For
        Incomplete Exam).
Steps : validate -> (only for REJECT) detect keywords -> generate suggested reasons.
The admin/HOD chooses and edits the reason; this agent only suggests.

explain_rejection_workflow is unchanged from the standalone rejection_agent.py;
the command-line report is not ported.
"""

from .rejection_explanation import generate_rejection_explanations
from .rejection_input import validate_agent5_result
from .rejection_keywords import detect_deterministic_keywords, judgment_keyword_options, load_keyword_vocabulary


def explain_rejection_workflow(agent5_result: dict) -> dict:
    validate_agent5_result(agent5_result)
    request_id = agent5_result.get("request_id")
    rec = agent5_result["recommendation"]
    if rec != "REJECT":
        return {"request_id": request_id, "status": "not_applicable",
                "message": f"Agent 5 recommended {rec}; rejection reasons are only generated for REJECT.",
                "deterministic_keywords": [], "judgment_keywords": [],
                "suggested_reasons": [], "conflict_note": ""}
    vocab = load_keyword_vocabulary()
    deterministic = detect_deterministic_keywords(agent5_result["evidence"], vocab)
    explained = generate_rejection_explanations(agent5_result, deterministic, judgment_keyword_options(vocab))
    return {"request_id": request_id, **explained}

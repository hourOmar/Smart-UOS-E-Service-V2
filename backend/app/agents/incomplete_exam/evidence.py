"""Agent 5's evidence package, exactly as the standalone
agent._build_evidence_package built it (same keys, same order, same values).
Collecting the inputs moved to request_data.py and proof_files.py; this
module only assembles them and decides nothing.

The proof source is the bucket only, so `file_source` is "bucket" or None and
`file_url` is always None (Proof_File_URL does not exist in the schema).
"""

from .policy_checks import evaluate_incomplete_exam_request, get_incomplete_exam_policy
from .request_data import IncompleteExamRequestData


def build_evidence_package(request_id: str, data: IncompleteExamRequestData, proof_files: list[dict]) -> dict:
    request = data.request
    student = data.student
    enrollment = data.enrollment
    policy = get_incomplete_exam_policy()
    policy_eval = evaluate_incomplete_exam_request(request, policy)

    proof_file_url = None
    proof_file_source = "bucket" if proof_files else None

    return {
        "request_id": request_id,
        "student": {"Student_ID": student["Student_ID"], "Student_Name": student["Student_Name"]},
        "course_id": request["Course_ID"],
        "section_id": request["Section_ID"],
        "term": request["Term"],
        "checks": {
            "enrollment": {
                "found": enrollment is not None,
                "record": enrollment,
            },
            "submission_window": policy_eval["submission_window"],
            "proof": {
                **policy_eval["proof"],
                "file_url": proof_file_url,
                "file_attached": bool(proof_files),
                "file_count": len(proof_files),
                "file_names": [f["filename"] for f in proof_files],
                "file_source": proof_file_source,
            },
            "exam_type": policy_eval["exam_type"],
        },
        "reason_for_review": policy_eval["reason_for_gemini_review"],
        "policy_reference": {
            "acceptable_proof_categories": policy_eval["acceptable_proof_categories"],
            "explicitly_invalid_reasons": policy_eval["explicitly_invalid_reasons"],
        },
    }

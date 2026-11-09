"""Incomplete Exam agents.

Agent 5 (Academic Eligibility Evaluation Agent For Incomplete Exam): Python
collects verified evidence (request, enrolment in Takes, submission window,
proof provided, exam type) and the student's proof documents; Gemini applies
the explicit decision rules and returns APPROVE, REJECT or MANUAL_REVIEW with an
explanation per check. Agent 6 (Rejection Explanation Agent), only after a
REJECT: deterministic keywords from the verified checks, Gemini-judged keywords
from a closed list, and three suggested reasons that Python validates. Both are
advisory: nothing here changes a request; the decision stays with staff.

Ported from the standalone project handed over on 2026-11-07 (commit ef22d2f).

Unchanged (byte-identical, pinned by SHA-256 in the tests):
- knowledge_base/incomplete_exam_policy.json, knowledge_base/rejection_keywords.json;
- the Agent 5 decision rules, attachment instructions and reply schema
  (eligibility_decision.py), and the Agent 6 rules and reply schema
  (rejection_gemini.py), including temperature 0.3 and the system instruction;
- the logic of policy_checks.py (= tools/exam_policy_tools.py) and
  rejection_explanation.py (= tools/explanation_generator.py): only the
  knowledge-file path and imports changed; rejection_keywords.py
  (= tools/rejection_keyword_tools.py) likewise, except the no-proof keyword
  (difference 11);
- explain_rejection_workflow and validate_agent5_result;
- the evidence package keys and the Agent 5 / Agent 6 result shapes, and the
  pipeline rule (Agent 6 only after REJECT).

Intentional differences (agent version 1.1.0):
1. Gemini failure (no key, unreachable on every configured model, unparsable
   reply) raises GeminiUnavailableError instead of returning an invented
   MANUAL_REVIEW; the run history records it as a technical failure. Agent 6's
   own fallback (template reasons built only from verified keywords) is kept,
   since it is not a recommendation.
2. Student identity (Student_ID, Student_Name, and the Student_ID inside the
   enrolment record) is removed from what Gemini receives; it stays in the
   evidence stored for staff. Gemini still sees the proof documents themselves.
3. Models: GEMINI_MODEL, then GEMINI_FALLBACK_MODELS from backend/.env (tried on
   HTTP 429/503) for both agents, through app.core.gemini. Agent 6 keeps its
   retries of the same model (after 1 s and 2 s); they now also apply to 429.
4. A recommendation other than APPROVE, REJECT or MANUAL_REVIEW is rejected
   (InvalidRecommendationError, a technical failure). The schema Gemini sees is
   unchanged.
5. Database: request_data.py replaces services/database.py and
   tools/request_tools.py, student_tools.py and enrollment_tools.py: the same
   queries, read as smart_uos_backend in ONE read-only transaction (closed
   before any Storage or Gemini call), plus a Request_Type check. Student
   columns not used by the evidence (email, CGPA, completed hours, program)
   are no longer read.
6. A request with no Incomplete_Exam row raises IncompleteExamDetailsMissingError
   (a distinct "details missing" state, before any Storage or Gemini call)
   instead of NotIncompleteExamRequestError.
7. Proof documents: only the private bucket, read with the signed-in staff
   member's own session (app.core.storage, staff read policy); no anon or
   service_role key, no get_/set_incomplete_exam_proofs RPC, no upload, no
   signed links, no local test folder, no Proof_File_URL fetch (the column does
   not exist; fetching arbitrary URLs is unsafe). In the evidence,
   file_source is "bucket" or null and file_url is always null.
   Paths must be exactly <Request_ID>/<file>; file type is checked by extension
   AND content signature; 10 MB per file (unchanged) and 18 MB in total.
   A listed file that cannot be found, a path outside the request's folder or
   a total above the limit is a data error; a Storage outage or refused
   session is a technical error -- never silently "no file attached".
8. Run history (service.py, repository.py; agents.incomplete_exam_evaluation):
   Agent 5 and, after a REJECT, Agent 6 run together as one stored run. A
   request without Incomplete_Exam details is shown as "details missing" and
   is never evaluated (no run row). Stored: recommendation, reasoning, check
   explanations, the verified checks, evidence, proof references and the
   rejection explanation -- never file contents or the staff token.
9. Output safeguard (1.2.0, output_safeguard.py; prompts and rules unchanged):
   Agent 5's generated text has the student's known name and ID (and UoS
   student numbers / e-mail addresses) replaced and unsupported
   document-verification wording rewritten neutrally, before Agent 6 receives
   it and before storage; Agent 6 suggestions that still identify the student
   or claim a document was verified are dropped (Agent 6's own template
   fallback applies). The recommendation, verified checks and evidence are
   never changed; the evidence records only the counts (output_safeguard).
10. Not ported: api.py, test_page.html, supabase_proof_storage.sql, config.py,
   .env files, the command-line reports and --student mode, and
   rejection_input_tools' file/paste parsing (command-line only).
11. No-proof keyword (1.3.0, rejection_keywords.py): Agent 6's deterministic
   keyword no_proof_provided is detected only when NO supporting document was
   attached (checks.proof.file_attached is False), instead of from the typed
   proof description (checks.proof.provided), which the student may leave
   empty while attaching a PDF. Evidence without file_attached keeps the
   original rule (provided is False). Agent 5's checks, the knowledge files,
   the prompts and the stored-run format are unchanged; runs stored before
   1.3.0 keep the keywords they were saved with.
"""

AGENT_NAME = "incomplete_exam"
AGENT_VERSION = "1.3.0"
STANDALONE_COMMIT = "ef22d2f"

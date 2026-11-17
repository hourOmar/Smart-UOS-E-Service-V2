"""Course Equivalency agents.

Eligibility Evaluation Agent (standalone "Agent 8"): Python collects and computes verified
evidence (request, transcript, catalog courses, study plan, transfer limit, the two
syllabi); Gemini extracts and matches the syllabus contents (quotes are verified in the
text by code), Python turns the matches into the similarity score, Gemini recommends
APPROVE / REJECT / MANUAL_REVIEW from the evidence and the decision rules, and
deterministic guardrails keep an unsafe APPROVE from going out. Rejection Explanation
Agent (standalone "Agent 9"), only after a REJECT: verified keywords from code, judged
keywords from Gemini's closed list, three suggested reasons validated by code. Both are
advisory: nothing here changes a request; the decision stays with staff.

Ported from the standalone project (commit 15ada5b).

Unchanged (pinned by SHA-256 in the tests):
- knowledge_base/equivalency_policy.json (weights 50/25/10/15, thresholds 80 / 60 -- marked
  "draft_thresholds" there, preserved and shown to staff --, partial match 0.5, 30 %
  unverified-match limit, transfer limits 60 / 70 / half of the plan), grade_policy.json
  (minimum C+, TR) and rejection_keywords.json;
- match_verifier.py (byte-identical), the similarity scoring (similarity.py), the policy
  helpers (policy.py), the study-plan / Program Change / transfer-limit decision logic
  (plan_tools.resolve_study_plan, transfer_limit), _constraints, _level_evidence,
  _apply_guardrails and the result shape (eligibility.py), the explanation generator,
  keyword detection and explain_rejection_workflow (rejection.py);
- the Gemini prompts, reply schemas and temperatures (gemini_calls.py: analysis 0.0,
  decision 0.0; rejection_gemini.py: 0.3).

Intentional differences (approved Phase 4 decisions):
1. Gemini failure (no key, unreachable on every configured model, unparsable reply) in the
   syllabus analysis or the decision raises GeminiUnavailableError: the run is stored as a
   failed technical run, never as MANUAL_REVIEW. The rejection agent keeps its own
   template fallback (not a recommendation).
2. Models: GEMINI_MODEL then GEMINI_FALLBACK_MODELS through app.core.gemini (429 / 503 move to
   the next model); no same-model retries (the standalone had none either).
3. Gemini never receives the student's name, Student_ID, CGPA, completed hours, the
   request's free-text Reason, the Program Change request ID or syllabus file names
   (gemini_calls.gemini_evidence). The stored evidence keeps them for staff.
4. Data: one read-only transaction as smart_uos_backend with fixed SQL (request_data.py)
   instead of SELECT * and column guessing; the study plan from Program_Study_Plan_Course
   (any version of the program, no currentness check), the plan total from
   Program_Study_Plan_Total, the college from Program; transferred credits = Takes rows
   graded TR (TR-only, as the standalone).
5. Old-course grade: the BEST attempt (Phase 2A order: A > B+ > ... > F, then latest term,
   then highest section) instead of the first passing row of an unordered transcript.
6. Syllabi: exactly the current registered version of each side (Phase 3A registry),
   downloaded with the signed-in staff member's own session (Phase 1 staff read policy),
   verified against the registry (size, SHA-256 -- or, for legacy rows without one, the
   hash recorded by earlier evaluations -- and MIME type) and the Phase 3B content checks
   before any text is extracted. PDF and DOCX only. No folder listing, no local folder,
   no anon / service_role key, no upload, no signed links.
7. Run history (service.py, repository.py; agents.course_equivalency_evaluation): one row per
   run; only In Progress requests with details and both syllabi are evaluated; one run at a
   time; a replaced syllabus marks the saved result as outdated (never re-run automatically).
   Stored: recommendation, reasoning, check explanations, deterministic results, evidence,
   syllabus REFERENCES and models -- never syllabus contents, extracted text, verbatim
   syllabus quotes or the staff token.
8. Output safeguard: e-mail addresses and UoS student numbers in Gemini-generated text are
   replaced; a suggested rejection reason containing one is dropped (template fallback).
9. Not ported: api.py, upload_syllabus.py, test_page.html, supabase_syllabus_storage.sql,
   config.py, services/storage.py, services/database.py, fetch_study_plans.py,
   study_plans.json, the samples folder and the command-line reports.
"""

AGENT_NAME = "course_equivalency"
AGENT_VERSION = "1.0.0"
STANDALONE_COMMIT = "15ada5b"

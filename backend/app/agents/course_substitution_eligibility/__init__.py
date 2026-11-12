"""Course Substitution Eligibility agent.

Five checks decide whether a Course Substitution request is ELIGIBLE,
NOT_ELIGIBLE or MANUAL_REVIEW: original course unavailable before graduation,
proposed course at the same level or higher, original course is a core course
(Gemini reads the official study plan with URL context), proposed course
offered in the current semester, proposed course not completed previously.
Only after NOT_ELIGIBLE, the rejection step builds deterministic keywords and
asks Gemini for three suggested reasons, which Python validates (with a
template fallback). Advisory only: nothing here changes a request; the
decision stays with staff.

Ported from the standalone project (course-substitution-eligibility-agent,
commit 32f83d3). The behavior contract is
docs/course-substitution-behavior-contract.md.

Unchanged (pinned in the tests):
- data/course_offerings_knowledge_base.txt, data/bachelors_program_catalog.txt
  and data/rejection_keywords.json, byte-identical (SHA-256);
- the five checks and their evidence texts, the term rule (including no
  Summer term: June-July give no current term), the overall-result rule and
  the three labels;
- the study plan prompt and its normalization, RULES, the rejection
  validation and fallback, and the keyword mapping;
- the result shapes, apart from the dropped fields in change 2.

Port changes (agent version 1.0.0):
1. Database access: request_data.py replaces services/database.py and
   config.py. The same queries run as the backend role through
   app.core.database.read_only(), in one read-only transaction closed before
   any Gemini call. The agent's own engine, its read-only connect hook,
   sslmode=require and .env loading are removed.
2. Columns dropped: Student_Email, CGPA, Completed_Hours (Student) and
   Credit_Hours (Course) are not read; the request dict no longer has
   student.student_email, student.cgpa, student.completed_hours or the
   courses' credit_hours. No check used them.
3. Request states: a missing request, a request of another type (checked
   after reading instead of in SQL) and missing Course_Substitution details
   are three distinct errors (RequestNotFoundError,
   NotCourseSubstitutionRequestError, CourseSubstitutionDetailsMissingError).
   A missing student or course, or an empty request ID, is a data error.
4. Gemini models and client: GEMINI_MODEL, then GEMINI_FALLBACK_MODELS,
   through app.core.gemini.generate_text_with_fallback (shared client,
   logging instead of print). The next model is tried after 5xx, 429 or 404;
   an empty reply stops at once.
5. Missing GEMINI_API_KEY: the run fails as a technical failure before any
   check runs (workflow.py), instead of the import-time RuntimeError.
6. Sanitization: Gemini failure text (check 3's evidence, the rejection
   step's gemini_error) passes through app.core.gemini.describe_failure.
7. Run history (Phase 4, not in this package yet):
   agents.course_substitution_evaluation and
   /api/staff/course-substitution/{id}.
8. Current term saved: current_term and current_semester are part of the
   stored result. The date-based rule is unchanged.
9. Models recorded: the model that answered each call is returned as
   study_plan_model and rejection_model.
10. Evidence snapshot: the request dict, the SHA-256 fingerprints of the three
   data files and collected_at.
11. Layout: flat modules with relative imports; data paths point to the
   package's data/ folder.
12. Not ported: pipeline.main, display_pipeline_report, agent.main,
   display_request_information, display_check, config.validate_config,
   rejection_input_tools.parse_eligibility_text and load_eligibility_result,
   the constraints text file in data/ (no code reads it; see the contract,
   section 12), and the standalone tests/ (replaced by offline tests).
"""

AGENT_NAME = "course_substitution_eligibility"
AGENT_VERSION = "1.0.0"
STANDALONE_COMMIT = "32f83d3"

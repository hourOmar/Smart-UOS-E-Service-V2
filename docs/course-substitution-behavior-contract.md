# Course Substitution agent: behavior contract and regression checklist

This file defines what the V2 port of the Course Substitution agent must do. Anything not
listed under **Port changes** must behave exactly as in the standalone agent.

- **Source:** `course-substitution-eligibility-agent`, commit `32f83d3`. The entry point is
  `pipeline.run_pipeline(request_id)`.
- **Target:** `backend/app/agents/course_substitution_eligibility/` in this repository.
- **Status:** approved plan. No code has been written yet.

The agent gives advisory results only. It never changes a request, and the final decision
stays with an authorized staff member.

## 1. Pipeline

```
run_pipeline(request_id)
  1. read the request                       (database; one read-only transaction)
  2. five eligibility checks                (Python; check 3 uses Gemini + URL context)
  3. overall result                         ELIGIBLE | NOT_ELIGIBLE | MANUAL_REVIEW
  4. rejection step, only for NOT_ELIGIBLE  (Python keywords; Gemini wording; Python validation)
```

There are at most two Gemini calls per run:

- **Study plan check:** always made once the program's study plan URL is found in the catalog.
- **Rejection wording:** made only for NOT_ELIGIBLE.

**Gemini never receives the student's identity:**

- The study plan prompt contains only the program ID, program name, original course ID and
  name, and the catalog URL.
- The rejection prompt contains only `overall_result`, the five checks, the deterministic
  keywords and the judgment keyword options.

## 2. Inputs

### 2.1 Database reads (backend role, read-only)

| Table | Columns | Filter |
|---|---|---|
| `Request` | `Request_ID`, `Request_Type`, `Request_Date`, `Submission_Time`, `Description`, `Current_Status`, `Student_ID` | `Request_ID = :rid` |
| `Course_Substitution` | `Request_ID`, `Original_Course_ID`, `Proposed_Course_ID`, `Reason` | `Request_ID = :rid`, `LIMIT 1` |
| `Student` | `Student_ID`, `Student_Name`, `Program_ID`, `Program_Name`, `Expected_Graduation_Term` | `Student_ID = :sid` |
| `Course` | `Course_ID`, `Course_Name` | `Course_ID = :cid`, run once for the original course and once for the proposed one |
| `Takes` | `Student_ID`, `Course_ID`, `Grade` | `SELECT DISTINCT "Course_ID"` for the student, where the course is the original or proposed one and `Grade IN ('A','B+','B','C+','C','D+','D')` |

Notes:

- The `Takes` filter counts a course as completed only with a passing grade. A NULL grade or
  any other grade does not count.
- `Course_Substitution` needs a new SELECT grant and a backend read policy. Every other column
  above is already read by existing V2 backend code.
- The run history also needs SELECT, INSERT and UPDATE on `agents.course_substitution_evaluation`.

### 2.2 Knowledge files (copied byte-identical, pinned by SHA-256)

| File | Used by | SHA-256 |
|---|---|---|
| `data/course_offerings_knowledge_base.txt` | Checks 1 and 4 | `c00ea9f5a789ee9bda79b2bed944aa338688bde9dd38eb06aaf5d5800fcb5cfd` |
| `data/bachelors_program_catalog.txt` | Check 3 (URL lookup) | `49324f1ea7f683af642845330201d469cec8683914a4023dcc633c1f724c52db` |
| `data/rejection_keywords.json` | Rejection step | `c16b99d46253901ddc47f54f52ebe32f883b7b46e065213edef279547ffb42ec` |

`data/course_substitution_constraints.txt` is not referenced by any code and is not ported.
See section 12.

**Offerings knowledge base format.** Only table rows of the form
`| Course ID | Course Name | Fall | Spring | Summer |` are read, and only when:

- the row has exactly five cells, and
- the Course ID is exactly 7 digits.

Each offering cell is normalized: `yes` becomes `YES`, `no` becomes `NO`, and anything else
becomes `UNKNOWN`. The comparison ignores case.

## 3. Term rule

`get_current_term()` uses today's date in the `Asia/Dubai` time zone.

| Month | Current term | Semester |
|---|---|---|
| August–December | `YYYY01` (YYYY = this year) | Fall |
| January–May | `YYYY02` (YYYY = last year) | Spring |
| June–July | none (`None`) | none |

Term arithmetic:

- **Valid term:** exactly 6 digits, ending in `01` or `02`. Anything else is invalid.
- **Next term:** `YYYY01` is followed by `YYYY02`, and `YYYY02` by `(YYYY+1)01`.
- **Summer:** has no term code. Only check 1 looks at it (see below).

`current_term` and `current_semester` are saved with every run. The request dict also carries
its own `current_term`, computed by the same rule in the database module. The checks use the
value from `eligibility_checks.get_current_term`.

### Known limitation: no Summer term

The agent's author confirmed that June–July is unsupported on purpose, because the dataset has
no Summer records. All current requests are for Fall 2026 (term `202601`). The port keeps this
behavior unchanged.

Outside August–May the current term is `None`, so `current_term` and `current_semester` are
`null` in the result and in the stored run. Then:

- **Checks 1 and 4 depend on the term.** Both return REQUIRES_REVIEW, with evidence
  `The current academic term could not be determined.` (check 1) and
  `The current Fall/Spring semester could not be determined.` (check 4).
- **Checks 2, 3 and 5 don't depend on the term** and run normally.
- **The overall result is therefore MANUAL_REVIEW, unless check 2, 3 or 5 is FAIL.** Under the
  rule in section 5, a FAIL still makes the result NOT_ELIGIBLE, even in June–July.

Example D1 in section 10 covers this case.

## 4. The five checks

The checks run in this order, and the result always contains all five. A course ID is
**valid** only if it is exactly 7 digits after trimming.

Each check returns `{condition, status, evidence}`. Check 3 also returns `source_url` and
`classification`.

### Check 1: "Original course unavailable before graduation"

These rules are applied in order; the first one that matches decides the result.

| # | Condition | Status | Evidence |
|---|---|---|---|
| 1 | Original course ID invalid | REQUIRES_REVIEW | `The original course ID is missing or invalid.` |
| 2 | Original course not in the offerings knowledge base | REQUIRES_REVIEW | `Course {id} is missing from the offerings knowledge base.` |
| 3 | Current term is `None` (June–July) | REQUIRES_REVIEW | `The current academic term could not be determined.` |
| 4 | Expected graduation term missing or invalid | REQUIRES_REVIEW | `The expected graduation term is missing or invalid.` |
| 5 | Graduation term is before the current term | REQUIRES_REVIEW | `The expected graduation term is earlier than the current academic term.` |
| 6 | Walk every term from the current term through the graduation term, in order (next table) | | |
| 7 | Nothing during the walk was YES or UNKNOWN | **PASS** | `{name} is not offered in any remaining semester through graduation. Checked: ….` |

During the walk, each term's semester (Fall or Spring) is looked up:

| Situation in a walked term | Status | Evidence |
|---|---|---|
| Offering is YES | **FAIL** (stops immediately) | `{name} is offered in a remaining {semester} semester. Checked: ….` |
| Offering is UNKNOWN | REQUIRES_REVIEW (stops immediately) | `The offering status for {name} is unknown in {semester}. Checked: ….` |
| The term is a Spring term before the graduation term, and its Summer offering is YES | **FAIL** | `{name} is offered in Summer before the expected graduation semester.` |
| Same, and its Summer offering is UNKNOWN | REQUIRES_REVIEW | `The Summer offering status is unknown.` |
| The next term can't be computed | REQUIRES_REVIEW | `Could not determine the remaining academic terms.` |

The `Checked:` list records each step, for example
`Spring (202602): NO, Summer after 202602: NO, Fall (202701): YES`.

### Check 2: "Proposed course is at the same level or higher"

- **Year:** the 5th digit of the course ID (index 4).
- **Level:** the last two digits.
- The department prefix is ignored.

| Condition | Status | Evidence |
|---|---|---|
| Either course ID is invalid | REQUIRES_REVIEW | `One or both course IDs are missing or invalid.` |
| Proposed year > original year, or the years are equal and proposed level ≥ original level | **PASS** | `Original year/level: Y/L; proposed year/level: Y/L.` |
| Otherwise | **FAIL** | The same text, plus ` The proposed course is lower under the defined rule.` |

### Check 3: "Original course is a core course" (Gemini with URL context)

Python first places a REQUIRES_REVIEW placeholder at position 3. The Gemini result then
replaces it in that position; if no placeholder is found, the result is appended.

**Step 1: find the study plan URL in the catalog.** The catalog is read as blocks with
`Program ID:`, `Program Name:` and `Official URL:` lines. Only blocks whose ID exactly matches
the student's `Program_ID` are candidates. Each candidate is scored by name:

| Score | Rule |
|---|---|
| 2 | One normalized name contains the other |
| 1 | Every word of the student's program name longer than 2 characters appears in the entry name |
| 0 | Neither |

Names are normalized by lowercasing, collapsing whitespace, and turning `–` into `-`.

Any of these results gives REQUIRES_REVIEW, with `source_url: null`, `classification: UNKNOWN`,
**and no Gemini call**:

- the catalog file is missing
- no candidate exists
- the best score is 0
- two candidates tie on the best score with different URLs

**Step 2: ask Gemini.** The prompt asks Gemini to read the URL with URL context and return one
JSON object: `status` (PASS, FAIL or REQUIRES_REVIEW), `classification` (COMPULSORY, ELECTIVE
or UNKNOWN), `evidence` and `source_url`. The reply is parsed with code fences stripped, and
the first `{…}` object is used if the whole reply isn't valid JSON.

**Step 3: normalize the reply.**

- An unknown status becomes REQUIRES_REVIEW, and an unknown classification becomes UNKNOWN.
- PASS with any classification other than COMPULSORY becomes REQUIRES_REVIEW.
- FAIL with any classification other than ELECTIVE becomes REQUIRES_REVIEW.
- Evidence becomes `"{catalog match text}. {Gemini evidence}"`, and `source_url` is Gemini's
  value, or the catalog URL if Gemini gave none.

**Step 4: on any exception** (a Gemini failure, an empty reply, or a reply that can't be
parsed), the result is REQUIRES_REVIEW with evidence
`Could not verify the official study plan with Gemini: {Type}: {message}` and
`classification: UNKNOWN`. In the port, this message is sanitized (see port change 6).

### Check 4: "Proposed course is offered in the current semester"

| Condition | Status | Evidence |
|---|---|---|
| Proposed course ID invalid | REQUIRES_REVIEW | `The proposed course ID is missing or invalid.` |
| Not in the knowledge base | REQUIRES_REVIEW | `Course {id} is missing from the offerings knowledge base.` |
| Current semester is `None` | REQUIRES_REVIEW | `The current Fall/Spring semester could not be determined.` |
| Offering is YES | **PASS** | `{name} is listed as offered in {semester}.` |
| Offering is NO | **FAIL** | `{name} is listed as not offered in {semester}.` |
| Offering is UNKNOWN | REQUIRES_REVIEW | `The knowledge base does not specify whether {name} is offered in {semester}.` |

`{name}` is the course name from the knowledge base, not from the database.

### Check 5: "Proposed course has not been completed previously"

| Condition | Status | Evidence |
|---|---|---|
| Proposed course ID invalid | REQUIRES_REVIEW | `The proposed course ID is missing or invalid.` |
| Completion data missing, or has no `proposed_course_completed` key | REQUIRES_REVIEW | `The student's course-completion information is unavailable.` |
| Completed with a passing grade (`True`) | **FAIL** | `Course {id} has previously been completed with a passing grade.` |
| Not completed (`False`) | **PASS** | `Course {id} has not been completed with a passing grade.` |
| Any other value | REQUIRES_REVIEW | `The student's course-completion status could not be determined.` |

### If the knowledge base can't be loaded

If loading raises `OSError` or `UnicodeError` (a missing file counts):

- checks 1 and 4 are REQUIRES_REVIEW, with evidence
  `Could not load course offerings knowledge base: {error}`;
- checks 2, 3 and 5 still run normally.

## 5. Overall result

`build_overall_result(request, current_term, checks)` decides the result:

1. Any check is FAIL → **NOT_ELIGIBLE**. A FAIL wins over REQUIRES_REVIEW.
2. Otherwise, there is at least one check and all are PASS → **ELIGIBLE**.
3. Otherwise → **MANUAL_REVIEW**. This includes an empty list of checks.

The result has the shape `{request_id, current_term, current_semester, overall_result, checks}`.
`current_semester` is `"Fall"`, `"Spring"` or `null`. The three labels are kept unchanged.

## 6. Rejection step

`explain_rejection_workflow(eligibility_result)`:

1. **Validate the input.**
   - `overall_result` must be one of the three labels.
   - `checks` must be a list of objects, each with `condition`, `status` and `evidence`.
   - Each status must be PASS, FAIL or REQUIRES_REVIEW.

   If validation fails, `InvalidEligibilityResultError` is raised. In the port this is a
   technical failure.
2. **Only for NOT_ELIGIBLE.** Any other result returns `status: "not_applicable"` with a
   message and empty keyword and reason lists, and makes no Gemini call.
3. **Deterministic keywords.** Every FAIL check is mapped by its exact condition text, in
   check order. A keyword missing from the vocabulary is skipped. Each entry is
   `{keyword, label, policy_basis, plain_reason}`.

   | FAIL condition | Keyword |
   |---|---|
   | Original course unavailable before graduation | `original_course_offered_before_graduation` |
   | Proposed course is at the same level or higher | `proposed_course_lower_level` |
   | Original course is a core course | `original_course_not_core` |
   | Proposed course is offered in the current semester | `proposed_course_not_offered` |
   | Proposed course has not been completed previously | `proposed_course_already_completed` |

4. **Judgment options.** These are the closed list of vocabulary entries with
   `detection: "judgment"`: `graduation_timing_not_satisfied`,
   `study_plan_requirement_not_confirmed` and `course_offering_information_uncertain`.
5. **Gemini wording.** Without URL context, the prompt is `RULES`, then
   `COURSE SUBSTITUTION ELIGIBILITY CONTEXT:`, then the context as JSON. The JSON is parsed
   with code fences stripped and the first object taken.
   - `judgment_keywords` must be a list, `suggested_reasons` a list, and `conflict_note` a
     string.
   - Any exception gives `status: "error"` with `error`, which the port sanitizes.
6. **Validation of Gemini's reply.** It applies only when the status is `ok`. The reply must
   meet all of these:
   - the judgment keywords are a subset of the options;
   - there are exactly 3 reasons;
   - each reason is an object with tone `formal`, `concise` or `supportive`, with no tone
     repeated;
   - each reason's text is non-empty;
   - each reason's `addresses_keywords` is a list drawn from the deterministic keywords plus
     the selected judgment keywords;
   - all three tones are present;
   - every deterministic keyword is covered by at least one reason.

   A reason may have an empty `addresses_keywords` list; this is kept as is. On success, each
   reason's keywords are filtered to the vocabulary.
7. **Fallback.** If Gemini wasn't ok or the reply failed validation, three template reasons
   are built from the deterministic keywords' `plain_reason` texts. `combined` is those texts
   joined by single spaces, in check order.

   | Tone | Text |
   |---|---|
   | formal | `Your Course Substitution request cannot be approved for the following reason(s): {combined}` |
   | concise | `{combined}` |
   | supportive | `Unfortunately, your proposed course substitution does not meet the eligibility requirements. {combined}` |

   Each reason addresses every deterministic keyword. `judgment_keywords` is `[]`,
   `conflict_note` is `""`, and `fallback_note` is
   `Gemini suggestions were unavailable or did not pass validation. These explanations were generated from verified rejection reasons.`
   If there are no deterministic keywords, the reasons list is empty.
8. **Result.**
   - `status` is `"gemini"` or `"fallback"`, alongside `overall_result`,
     `deterministic_keywords`, `judgment_keywords`, `suggested_reasons`, `conflict_note`,
     `fallback_note` (`None` when the source is Gemini) and `gemini_error`.
   - `gemini_error` is the sanitized error, or `None`. It can be non-`None` while
     `status = "fallback"`.

## 7. Gemini calls and fallback behavior

Both calls go through one wrapper, `llm_client.generate_with_fallback(prompt, use_url_context=False)`.

**Models:** `GEMINI_MODEL`, then each entry of `GEMINI_FALLBACK_MODELS`, in order. These come
from the V2 backend settings and replace the agent's hard-coded list.

**When to try the next model:**

| Failure | What happens |
|---|---|
| A server error (any 5xx, `genai.errors.ServerError`), or a client error with code **429** or **404** | Try the next model |
| Any other API error (400, 401, 403, …) or any non-API exception | Stop immediately |
| A reply with empty or `None` text | **Stop immediately.** Raise; never try the next model |
| Every model failed with a retryable error | Raise one error listing each model's sanitized failure |

**How failures affect the result:**

| Failure | Effect |
|---|---|
| Study plan call fails | Check 3 becomes REQUIRES_REVIEW, so the result is MANUAL_REVIEW unless another check is FAIL. The run still completes |
| Rejection call fails | The fallback reasons are used. The run still completes |
| `GEMINI_API_KEY` not configured | The run fails as a technical failure before any check runs (see port change 5) |

**Other behavior:**

- The model that answered each call is recorded and stored as `study_plan_model` and
  `rejection_model` (`null` when no call was made or answered).
- There are no same-model retries, temperature settings or structured-output schemas; the
  standalone agent has none.

## 8. Run lifecycle (copied from the Incomplete Exam pattern)

**Automatic first evaluation.** It runs only if all of these hold, checked under the request's
advisory lock on values read in the same transaction:

- the request has no previous run;
- `Current_Status = 'In Progress'`;
- the `Course_Substitution` details exist.

**Rerun.** Allowed only while the request is In Progress and has details. Otherwise the call
fails with `RerunNotAllowedError` or `CourseSubstitutionDetailsMissingError`.

**Request states that never create a run row:**

| State | API response |
|---|---|
| Request not found | 404 |
| Not a Course Substitution request | 404 |
| Details missing | A `details_missing` state; never evaluated |

**Concurrency and interruptions.**

- Only one run per request can be `running` at a time, enforced by the advisory lock plus a
  unique index.
- A run that is still `running` after 10 minutes is marked failed with `failure_kind 'interrupted'`.

**Failed runs.** A run fails with `failure_kind 'data'` or `'technical'` and a sanitized
message of at most 2,000 characters. A failed run never carries a result.

| Failure kind | Causes |
|---|---|
| Data | Student not found; original or proposed course not found; empty request ID |
| Technical | Database unavailable or refused; invalid eligibility result; missing Gemini key; unexpected errors (logged with code locations only) |

**Stored on completion:**

- the result: `overall_result`, `current_term`, `current_semester`, `checks`;
- `rejection` (only for NOT_ELIGIBLE);
- the evidence snapshot: the request dict, the SHA-256 fingerprints of the three knowledge
  files, and `collected_at`;
- `study_plan_model`, `rejection_model` and `agent_version`.

**What the page shows.** `current` is the newest completed run, and a newer failed or
unfinished attempt is shown separately as `latest_attempt`. A failed rerun never hides the
last good result.

## 9. Port changes (the complete list)

The agent version is `1.0.0`; the standalone commit is `32f83d3`.

1. **Database access.** `request_data.py` replaces `services/database.py` and `config.py`.
   - The same queries run as the backend role through `app.core.database.read_only()`, in one
     read-only transaction that is closed before any Gemini call.
   - The agent's own engine, the `default_transaction_read_only` connect hook,
     `sslmode=require` and `.env` loading are all removed.
2. **Columns dropped.** `Student_Email`, `CGPA`, `Completed_Hours` (Student) and
   `Credit_Hours` (Course) are no longer read.
   - The request dict no longer has `student.student_email`, `student.cgpa`,
     `student.completed_hours`, `original_course.credit_hours` or `proposed_course.credit_hours`.
   - No check used them.
3. **Request states.**
   - **Before:** the query filtered on `Request_Type = 'Course Substitution'` in SQL, so a
     missing request and a request of another type both returned `None`, and a missing
     `Course_Substitution` row raised `ValueError`.
   - **Now:** these are three distinct errors: `RequestNotFoundError`,
     `NotCourseSubstitutionRequestError` (the type is checked after reading) and
     `CourseSubstitutionDetailsMissingError`.
   - A missing student or course is still a data error.
4. **Gemini models and client.**
   - Models now come from `GEMINI_MODEL` and `GEMINI_FALLBACK_MODELS`; the six-model list is
     gone.
   - Calls go through `app.core.gemini.generate_text_with_fallback`, with the shared client,
     logging instead of `print`, and `is_temporary` set to 5xx, 429 or 404.
   - The agent's rule is kept: an empty reply stops immediately.
5. **Missing `GEMINI_API_KEY` (proposed).**
   - **Before:** the standalone `llm_client` raised `RuntimeError` at import, so nothing ran.
   - **Now:** the service records a failed technical run, `GEMINI_API_KEY is not configured.`,
     before any check runs.
   - This keeps a misconfigured backend from returning MANUAL_REVIEW for every request.
6. **Sanitization.** All Gemini failure text passes through `app.core.gemini.sanitize` (via
   `describe_failure` and `GeminiUnavailableError`) before it is stored or shown. This
   applies to:
   - check 3's exception evidence;
   - the rejection step's `gemini_error`;
   - every failed-run `error_message`, which is also truncated to 2,000 characters.
7. **Run history.** Results are stored in `agents.course_substitution_evaluation` under the
   rules in section 8, and the API is `/api/staff/course-substitution/{id}`.
8. **Current term saved.** `current_term` and `current_semester` are stored with each run.
   The date-based rule itself is unchanged.
9. **Models recorded.** The model that answered each call is stored as `study_plan_model` and
   `rejection_model`.
10. **Evidence snapshot.** The request dict is stored together with the SHA-256 fingerprints
    of the three knowledge files and `collected_at`.
11. **Layout.** The modules are flat in the package with relative imports. The paths to the
    knowledge base, catalog and keyword file point to the package's `data/` folder.
12. **Not ported.**
    - the command-line entry points: `pipeline.main`, `display_pipeline_report`, `agent.main`,
      `display_request_information` and `display_check`;
    - `config.validate_config`;
    - `rejection_input_tools.parse_eligibility_text` and `load_eligibility_result`
      (command line only);
    - `data/course_substitution_constraints.txt` (no code reads it; see section 12 before
      porting or using it);
    - the standalone `tests/`. They need a live database and Gemini, and two of them import
      functions that don't exist (`eligibility_checks.evaluate_eligibility` and
      `rejection_agent.display_rejection_report`). They are replaced by offline tests.

**Unchanged:**

- the five checks and their evidence texts;
- the study plan prompt and its normalization;
- `RULES` and the rejection validation and fallback;
- the keyword mapping;
- the overall-result rule and the three labels;
- the term rule, including the unsupported Summer term (section 3);
- the result shapes, apart from the dropped fields in port change 2;
- the three knowledge files (byte-identical).

## 10. Regression examples

All of these were run against the standalone code at `32f83d3`, with the agent's own data
files and with the database and Gemini stubbed. In every example, the student's `Program_ID`
is `1501` and `Program_Name` is `Bachelor of Science in Computer Science`, which matches the
catalog URL `https://www.sharjah.ac.ae/academics/degree/undergraduate/computer-science`.

### Example A: ELIGIBLE (one Gemini call, no rejection step)

**Inputs:**

| Input | Value |
|---|---|
| Date | 2026-11-11 (current term `202601`, Fall) |
| Original course | `1501246` Object Oriented Design with Java |
| Proposed course | `1501459` Information Security |
| Expected graduation | `202601` |
| Proposed course completed | `False` |
| Stubbed study plan reply | `{"status":"PASS","classification":"COMPULSORY","evidence":"Listed under Major Compulsory Courses.", …}` |

**Expected:**

| Check | Status | Evidence |
|---|---|---|
| 1 | PASS | `Object Oriented Design with Java is not offered in any remaining semester through graduation. Checked: Fall (202601): NO.` |
| 2 | PASS | `Original year/level: 2/46; proposed year/level: 4/59.` |
| 3 | PASS | `Matched catalog program: Bachelor of Science in Computer Science. Listed under Major Compulsory Courses.` (`classification: COMPULSORY`) |
| 4 | PASS | `Information Security is listed as offered in Fall.` |
| 5 | PASS | `Course 1501459 has not been completed with a passing grade.` |

The overall result is **ELIGIBLE**. The rejection step returns `status: "not_applicable"`.
Exactly one Gemini call is made, with `use_url_context=True`.

Variants:

- **Graduation term stored as text:** the same inputs with `"202601"` instead of the integer
  give the same check 1 result.
- **Gemini fails:** check 3 is REQUIRES_REVIEW, so the result is **MANUAL_REVIEW**.

### Example B: rejection step on the agent's own fixture (`tests/test_rejection_agent.py`)

**Input:** `overall_result: NOT_ELIGIBLE`, where only check 2 is FAIL, with the evidence
`Original level: 72. Proposed level: 42.`. The rejection Gemini call fails.

**Expected:**

- `deterministic_keywords` is exactly `[proposed_course_lower_level]`, with its label,
  policy basis and plain reason.
- `status` is `"fallback"`, `judgment_keywords` is `[]` and `conflict_note` is `""`.
- There are three reasons, each with `addresses_keywords: ["proposed_course_lower_level"]`:
  - **formal:** `Your Course Substitution request cannot be approved for the following reason(s): The proposed replacement course is at a lower academic level than the original course. A replacement must be at the same level or a higher level.`
  - **concise:** `The proposed replacement course is at a lower academic level than the original course. A replacement must be at the same level or a higher level.`
  - **supportive:** `Unfortunately, your proposed course substitution does not meet the eligibility requirements. The proposed replacement course is at a lower academic level than the original course. A replacement must be at the same level or a higher level.`
- `gemini_error` is set and sanitized.
- Exactly one Gemini call is made, with `use_url_context=False`.

### Example C: NOT_ELIGIBLE through the Spring → Summer → Fall walk; FAIL beats REQUIRES_REVIEW

**Inputs:**

| Input | Value |
|---|---|
| Date | 2027-02-10 (current term `202602`, Spring) |
| Original course | `1501322` Professional, Social and Ethical Issues in CS |
| Proposed course | `1501116` Programming I |
| Expected graduation | `202701` |
| Proposed course completed | `True` |
| Study plan Gemini call | Fails |

**Expected:**

| Check | Status | Evidence |
|---|---|---|
| 1 | FAIL | `Professional, Social and Ethical Issues in CS is offered in a remaining Fall semester. Checked: Spring (202602): NO, Summer after 202602: NO, Fall (202701): YES.` |
| 2 | FAIL | `Original year/level: 3/22; proposed year/level: 1/16. The proposed course is lower under the defined rule.` |
| 3 | REQUIRES_REVIEW | `Could not verify the official study plan with Gemini: …` (sanitized) |
| 4 | PASS | `Programming I is listed as offered in Spring.` |
| 5 | FAIL | `Course 1501116 has previously been completed with a passing grade.` |

The overall result is **NOT_ELIGIBLE**, and `current_semester` is `"Spring"`.

The deterministic keywords, in order, are `original_course_offered_before_graduation`,
`proposed_course_lower_level` and `proposed_course_already_completed`. With the rejection call
failing, the fallback `concise` text is those three `plain_reason` texts joined by single
spaces.

### Example D: no current term in June–July, and an UNKNOWN offering

**D1. No current term.**

| Input | Value |
|---|---|
| Date | 2026-06-15 |
| Original course | `1501246` |
| Proposed course | `1501459` |
| Expected graduation | `202602` |
| Proposed course completed | `False` |
| Study plan reply | PASS / COMPULSORY |

Expected: `current_term: null`, `current_semester: null`.

| Check | Status | Evidence |
|---|---|---|
| 1 | REQUIRES_REVIEW | `The current academic term could not be determined.` |
| 2 | PASS | |
| 3 | PASS | |
| 4 | REQUIRES_REVIEW | `The current Fall/Spring semester could not be determined.` |
| 5 | PASS | |

The overall result is **MANUAL_REVIEW**, the rejection step returns `not_applicable`, and
`current_term: null` is stored with the run.

**D2. UNKNOWN offering.** On 2026-11-11, with original course `1501355` (Computer
Architecture, Unknown in every semester), proposed course `1501459` and expected graduation
`202602`:

- check 1 is REQUIRES_REVIEW with evidence
  `The offering status for Computer Architecture is unknown in Fall. Checked: Fall (202601): UNKNOWN.`;
- the overall result is **MANUAL_REVIEW**, given no FAIL elsewhere.

## 11. Regression checklist

These checks must all hold, and must all run offline (no database, network or Gemini).

**Knowledge files and texts**

- [ ] The three knowledge files match the SHA-256 values in section 2.2.
- [ ] The study plan prompt, rendered for the Example A inputs, and `RULES` match the
      standalone texts. Pin them by SHA-256 in the tests, as the Incomplete Exam port does.

**Term rule**

- [ ] The month table gives Aug → `YYYY01`, Jan → `(YYYY-1)02`, and Jun/Jul → `None`, using
      the Dubai date.
- [ ] **No Summer term.** On a June or July date, checks 1 and 4 are REQUIRES_REVIEW and
      `current_term` / `current_semester` are stored as `null`. The result is MANUAL_REVIEW
      when checks 2, 3 and 5 don't FAIL, and NOT_ELIGIBLE when one of them does (e.g. a
      lower-level proposed course on 2026-06-15).
- [ ] `next_term` and `term_order` handle the boundaries (`202601 → 202602 → 202701`), and
      invalid terms (`2026`, `202603`, `"abc"`) give `None`.

**Check 1**

- [ ] Each row of the check 1 tables is covered, including FAIL on Summer, REQUIRES_REVIEW on
      an UNKNOWN Summer, and graduation before the current term.
- [ ] The walk stops at the first YES or UNKNOWN, and Summer is checked only after a Spring
      term that is before graduation.

**Checks 2, 4 and 5**

- [ ] Check 2 uses the 5th digit and the last two digits only (e.g. `1501454` vs `1501459`:
      same year, 54 < 59). Invalid IDs give REQUIRES_REVIEW.
- [ ] Each row of the check 4 and check 5 tables is covered.

**Check 3**

- [ ] **Catalog lookup:** an exact ID with score 2 or 1 matches; no candidate, score 0 or a
      tie with different URLs gives REQUIRES_REVIEW **with no Gemini call**.
- [ ] **Reply normalization:**
  - PASS + ELECTIVE and FAIL + COMPULSORY become REQUIRES_REVIEW;
  - FAIL + ELECTIVE stays FAIL;
  - an unknown status or classification is normalized;
  - fenced JSON parses;
  - non-JSON text gives REQUIRES_REVIEW.
- [ ] Check 3 replaces the placeholder at position 3, and the result always has five checks
      in order.

**Overall result**

- [ ] FAIL beats REQUIRES_REVIEW; all PASS gives ELIGIBLE; no checks gives MANUAL_REVIEW.
- [ ] A knowledge base load failure makes checks 1 and 4 REQUIRES_REVIEW while 2, 3 and 5
      still run.

**Rejection step**

- [ ] It runs only for NOT_ELIGIBLE, and with no Gemini call otherwise.
- [ ] The keyword mapping keeps check order, and keywords missing from the vocabulary are
      skipped.
- [ ] Each validation rule in section 6, step 6 rejects a bad reply and falls back:
  - an unknown judgment keyword;
  - 2 or 4 reasons;
  - a bad or duplicate tone;
  - empty text;
  - a keyword outside the allowed set;
  - an uncovered deterministic keyword.
- [ ] A valid reply gives `status "gemini"` and `fallback_note None`.
- [ ] An invalid eligibility result raises `InvalidEligibilityResultError`, and the run is
      recorded as a technical failure.

**Gemini wrapper**

- [ ] Models are tried in the order `GEMINI_MODEL`, then `GEMINI_FALLBACK_MODELS`.
- [ ] 5xx, 429 and 404 go to the next model; 400, 401 and 403 stop; an empty reply stops
      without trying the next model.
- [ ] When every model fails, the error message names each model and is sanitized.

**Gemini inputs and sanitization**

- [ ] Neither prompt contains the student's ID, name or email (assert on the rendered prompts).
- [ ] An API key, `key=` value, bearer token, email or UoS student number inside a Gemini
      error never reaches the stored check 3 evidence, `gemini_error` or a failed-run
      `error_message`.

**Database reads**

- [ ] `request_data` reads only the columns in section 2.1. Changing the type gives
      `NotCourseSubstitutionRequestError`; a missing details row gives
      `CourseSubstitutionDetailsMissingError` with no run row; a missing student or course is
      a data failure.

**Run lifecycle**

- [ ] **Starting runs:**
  - automatic only for In Progress requests with no previous run;
  - reruns only while In Progress;
  - 409 while another run is active;
  - a run stuck past 10 minutes is marked interrupted.
- [ ] **Completed runs** store `overall_result`, `current_term`, `current_semester`, the
      checks, `rejection` (NOT_ELIGIBLE only), the evidence with fingerprints, and both model
      names.
- [ ] **Failed runs** never store a result.
- [ ] **Staff only:** the API returns 401 without a session and 403 for non-staff, before any
      read.

**Isolation**

- [ ] The package contains no `load_dotenv`, `os.getenv`, `genai.Client`, `print(`, service
      role key or writes to `public.*` tables (same isolation test as Incomplete Exam).
- [ ] Until section 12 is resolved, the package contains no
      `course_substitution_constraints.txt` and no code or prompt mentions it.

## 12. Open question: constraints file

**The author's statement.** The agent's author says `data/course_substitution_constraints.txt`
is given to Gemini as part of the evidence package.

**What the code shows.** This doesn't match the code on `main` at commit `32f83d3`:

- **No code reads the file.** A `git grep` of the whole repository at `32f83d3`, and at the
  earlier commit `0ba9029` that added it, finds no reference outside the file itself.
- **Neither Gemini prompt includes it.**
  - **Study plan prompt** (`study_plan_check.check_original_course_is_core`): it contains only
    the catalog URL, the program ID and name, and the original course ID and name.
  - **Rejection prompt** (`services/rejection_gemini.get_rejection_suggestions`): it contains
    only `RULES` and a context of `overall_result`, the checks, the deterministic keywords and
    the judgment keyword options.
- **The other two data files are read by their own code.** `study_plan_check.py` reads
  `bachelors_program_catalog.txt`, and `eligibility_checks.py` reads
  `course_offerings_knowledge_base.txt`.

**Until the author confirms where the file is used** (another branch, an unpushed change, or
another version of the agent):

- The port does not copy the file, read it, fingerprint it, or add it to any prompt or evidence
  package.
- No use of it is invented. Both prompts stay byte-identical to `32f83d3`.
- The behavior in this contract is the behavior without the file.

**If the author shows code that uses it,** this contract is updated first, and only then the
port: say where the file enters a prompt or check, record its SHA-256 in section 2.2, and add
regression examples showing its effect on the result.

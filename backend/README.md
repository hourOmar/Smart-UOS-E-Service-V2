# Smart UoS E-Service — Backend

Python (FastAPI) backend for staff-only features that need server-side credentials: the AI
agents and their run history. The frontend never receives a database password or Gemini key.
For the project overview and full setup, see the [main README](../README.md).

## Architecture

```
app/
  main.py          FastAPI app, CORS (FRONTEND_ORIGINS), routers, GET /api/health
  config.py        settings from environment variables / backend/.env
  core/            shared by every agent
    database.py    one SQLAlchemy engine (DATABASE_URL); read_only() and write_transaction()
    auth.py        require_staff / require_staff_session: Supabase session + Authorized_Staff
    gemini.py      one Gemini client: structured replies, optional system instruction,
                   temperature, attachments (PDF/images), retries and fallback models
    storage.py     Supabase Storage downloads made with the staff member's own session
  api/             staff-only routes, one module per feature
    raise_capacity_review.py   raise_capacity_priority.py
    program_change_review.py   incomplete_exam_review.py
  agents/          one package per agent
    raise_capacity_eligibility/   Raise Capacity Academic Eligibility Evaluation Agent
    raise_capacity_priority/      Raise Capacity Prioritization Agent
    program_change_eligibility/   Program Change Eligibility Agent
    incomplete_exam/              Incomplete Exam Eligibility + Rejection Explanation Agents
tests/             offline tests (no network, database or Gemini)
  priority_agent/  program_change/  incomplete_exam/  plus shared core tests
```

Each agent package follows the same pattern: **evidence** read from the database (and, where
needed, official UoS pages or proof documents) → **deterministic checks** in Python →
**Gemini** writes the assessment → a **service** module manages runs (start rules, locking,
failures) → a **repository** module stores every run.

**Dependencies** (`requirements.txt`): FastAPI, Uvicorn, SQLAlchemy 2, psycopg 3, google-genai,
Pydantic 2, python-dotenv, Requests, Beautiful Soup 4. `requirements-dev.txt` adds pytest and
httpx.

## AI agents

All recommendations are **advisory**. No agent approves, rejects or changes a request.

### Raise Capacity Academic Eligibility Evaluation Agent (`raise_capacity_eligibility/`)

Evidence: the request, the student's transcript, course capacity, completed hours, grade policy
and prerequisites (from the UoS Computer Science degree page, cached for one hour). Gemini
decides `APPROVE` / `REJECT` / `MANUAL_REVIEW` from the verified evidence; missing evidence is
never a rejection. The student's ID and name are not sent to Gemini. Runs once on the first
opening of a request that was never evaluated, then on "Re-run". Stored in
`agents.raise_capacity_evaluation`.

### Raise Capacity Prioritization Agent (`raise_capacity_priority/`)

Ported from a standalone agent with its rules, system instruction and knowledge files unchanged.
Computes evidence in Python; Gemini decides `HIGH` / `MEDIUM` / `LOW` / `MANUAL_REVIEW`. The
student's ID is not sent to Gemini. Runs automatically for visible In Progress Raise Capacity
requests without a priority (at most two at a time per backend process) and on manual retry.
Results are saved only through `agents.save_raise_capacity_priority` into
`Raise_Capacity."Priority_Level"` and `"Priority_Result"`, and only when both are empty; run
history is in `agents.raise_capacity_priority_run`.

| State | Meaning | Automatic run | Retry |
|---|---|---|---|
| `saved` | Both fields hold a valid result | No | No |
| `needs_attention` | Partial, unknown or malformed saved values | No | No |
| `running` | A check is in progress | — | No |
| `failed` | The latest check failed or was interrupted | No | Yes (In Progress requests) |
| `not_started` | No saved value and no check yet | In Progress requests only | No |
| `not_found` | Unknown ID or not a Raise Capacity request | No | No |

### Program Change Eligibility Agent (`program_change_eligibility/`)

Ported from a standalone agent (prompts and data files unchanged). Reads the request and the
student's record, computes CGPA and applicable credit hours deterministically (minimums: CGPA
2.0 and 15 applicable hours), and asks Gemini to read the requested program's official UoS study
plan and write the assessment ending in `APPROVE` / `REJECT` / `REQUIRES_REVIEW`. Runs once on
the first opening of a request that was never evaluated, then on re-evaluation while In Progress.
Stored in `agents.program_change_evaluation`.

### Incomplete Exam agents (`incomplete_exam/`, version 1.3.0)

Ported from a standalone project; the knowledge files, decision rules, prompts and result shapes
are unchanged (the package docstring lists every intentional difference).

- **Incomplete Exam Eligibility Agent (Agent 5).** Reads the request, its `Incomplete_Exam`
  details, the student and the enrolment (`Takes`) in one read-only transaction, then downloads
  the PDF proofs listed in `Proof_Files`. Deterministic checks: enrolment, the 4-working-day
  submission window (Friday and Saturday excluded), proof, exam type. Gemini receives the
  evidence and the proof documents and returns `APPROVE` / `REJECT` / `MANUAL_REVIEW` with an
  explanation per check. Proof only counts as verified when a document is attached and reviewed;
  the AI does **not** verify that documents are authentic.
- **Rejection Explanation Agent (Agent 6).** Runs in the same run **only after a REJECT**.
  Deterministic keywords come from the verified checks (for example, `no_proof_provided` only
  when no document was attached); Gemini may add judgment keywords from a closed list and writes
  three suggested explanations (formal, concise, supportive). Python drops unknown keywords,
  reasons that cite none, and reasons with numbers not in the evidence; if nothing usable remains,
  template reasons built from the verified keywords are used.
- **Output safeguard:** Agent 5's text has the student's name, ID and e-mail replaced and
  unsupported "document verified" wording neutralized before Agent 6 sees it and before storage;
  Agent 6 suggestions that still identify the student are dropped. The student's identity is not
  sent to Gemini.
- Evaluations start only when staff ask (`Run Evaluation` / `Re-evaluate` in the frontend).
  Both agents' results are stored together as one run in `agents.incomplete_exam_evaluation`.

## API (staff only)

Every route except `/api/health` verifies the caller's Supabase session
(`Authorization: Bearer <access token>`) with Supabase Auth, then requires an
`Authorized_Staff` link: **401** without a valid session, **403** for non-staff.

| Route | Purpose |
|---|---|
| `GET /api/health` | Liveness check, no data |
| `GET /api/staff/raise-capacity/{request_id}/review` | Request, student, transcript and evaluation state; never runs the agent |
| `POST /api/staff/raise-capacity/{request_id}/evaluations` `{"rerun": bool}` | First evaluation (only if never evaluated) or a re-run; 409 while a run is in progress |
| `GET /api/staff/raise-capacity/priorities?request_id=…` | Priority state of up to 100 requests; never runs the agent |
| `POST /api/staff/raise-capacity/priorities/automatic` `{"request_ids": [...]}` | Starts checks for eligible requests and returns every state |
| `POST /api/staff/raise-capacity/{request_id}/priority/retry` | Manual retry after a failed or interrupted check |
| `GET /api/staff/program-change/{request_id}/evaluation` | Saved evaluation state; never runs the agent |
| `POST /api/staff/program-change/{request_id}/evaluations` `{"rerun": bool}` | First evaluation (never evaluated, In Progress) or re-evaluation (In Progress); 409 when not allowed |
| `GET /api/staff/incomplete-exam/{request_id}/evaluation` | Saved evaluation state; never runs the agents |
| `POST /api/staff/incomplete-exam/{request_id}/evaluations` `{"rerun": bool}` | First evaluation (never evaluated, In Progress, details present) or re-evaluation (In Progress, details present); 409 when not allowed or already running |

Evaluation responses separate `current` (the newest completed result) from `latest_attempt` (a
newer failed, interrupted or running attempt), so a failed re-run never hides the last good
result. Technical failures are shown to staff as short messages; details stay in the database.

## Database access and run history

- The backend connects as the restricted role **`smart_uos_backend`** (`DATABASE_URL`), never as
  `postgres` or with the service_role key. The role has read access only to the columns the agents
  need, under row-level security policies, and cannot change requests.
- Each run is stored in the `agents` schema (`raise_capacity_evaluation`,
  `raise_capacity_priority_run`, `program_change_evaluation`, `incomplete_exam_evaluation`). Table
  constraints guarantee that a failed run never carries a recommendation, a completed run always
  carries its full result, and finished runs cannot be changed. History is kept; nothing is
  deleted.
- **One run at a time per request:** start decisions are made under a Postgres advisory lock, a
  unique index allows only one running row per request, and a run still running after 10 minutes
  is marked interrupted.
- Proof files are stored as references only (path, outcome, type, size, SHA-256), never as file
  contents; access tokens are never stored.

## Private Storage and proof documents

Incomplete Exam proofs live in the private Supabase Storage bucket `incomplete-exam-proofs`
(paths `<Request_ID>/<file>.pdf`). The backend has **no Storage credentials of its own**: it
downloads each proof with the requesting staff member's own access token
(`require_staff_session`), so Storage applies the staff read policy. The token is used only for
that request and is never stored, logged or returned. Paths must stay inside the request's folder,
the type is checked by extension and content signature, and files are limited to 10 MB each and
18 MB in total. A missing listed file or a path outside the folder is a data error; a Storage
outage or refused session is a technical error.

## Gemini, fallbacks and failures

| Agent | Models |
|---|---|
| Raise Capacity eligibility | `GEMINI_MODEL` |
| Raise Capacity priority, Incomplete Exam (Agents 5 and 6) | `GEMINI_MODEL`, then `GEMINI_FALLBACK_MODELS` after a temporary error (HTTP 429 or 503); Agent 6 also retries the same model after 1 s and 2 s |
| Program Change eligibility | Its own fixed, ordered model list in `llm_client.py` (moves on after a 5xx or 429) |

Errors are sanitized before they are logged or stored. A Gemini outage, an unusable reply or a
database or Storage failure is recorded as a failed run (`technical`); problems with the request's
own data are `data` failures. Neither is ever stored as a recommendation.

## Final decisions

The backend does not record decisions. Staff decide on the review pages; the frontend calls the
database functions `decide_raise_capacity_request`, `decide_program_change_request` and
`decide_incomplete_exam_request` with the staff member's own session. Those functions write the
decision and change the request status; the existing database triggers record history,
notifications and the audit log.

## Setup and running (Windows CMD, in the `backend` folder)

```cmd
py -3.14 -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
copy .env.example .env
notepad .env
.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

The API is then available at http://127.0.0.1:8000 (health check: `/api/health`). The frontend's
development server proxies `/api` to this address.

### Environment variables (`backend/.env`, never committed)

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection as `smart_uos_backend` (ask the project owner) |
| `SUPABASE_URL` | Yes | Supabase project URL: verifies sessions and downloads proofs |
| `SUPABASE_ANON_KEY` | Yes | Supabase public anon key, sent with each user's own token |
| `GEMINI_API_KEY` | Yes, for AI features | Gemini API key |
| `GEMINI_MODEL` | No | Primary model (default `gemini-3.6-flash`) |
| `GEMINI_FALLBACK_MODELS` | No | Comma-separated fallback models (see above) |
| `FRONTEND_ORIGINS` | No | Comma-separated browser origins allowed by CORS (default `http://localhost:5173`) |

Timeouts for Supabase Auth and Storage calls are fixed in `app/config.py`.

## Tests

```cmd
.venv\Scripts\python -m pytest
```

All tests run offline with fakes for the database, Storage and Gemini.

## Known limitations

- Incomplete Exam is limited to final exams only by the student form; the agents and the
  database functions do not enforce it.
- The AI reads proof documents but does not verify their authenticity.
- Raise Capacity prerequisites are verified only from the UoS Computer Science degree page;
  other courses are reported as unverified (`MANUAL_REVIEW`).
- Another team backend that connects as `postgres` can still overwrite the Raise Capacity
  priority fields directly; this backend cannot prevent that.
- Runs stored before Incomplete Exam agent 1.3.0 keep the rejection keywords they were saved with.
- The database scripts that created the role, policies, tables and functions are kept locally by
  the project owner and are not in this repository.

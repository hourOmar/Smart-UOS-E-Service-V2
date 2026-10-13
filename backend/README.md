# Smart UoS E-Service backend

Python (FastAPI) backend for staff-only features that need server-side credentials.
The frontend never receives a database password or Gemini key.

## Layout

```
app/
  main.py          FastAPI app, CORS, routers
  config.py        settings from environment / backend/.env
  core/            shared by every agent
    database.py    one engine; read_only() and write_transaction()
    gemini.py      one Gemini client; generate_structured(prompt, schema), optional
                   system instruction and fallback models (429/503 only)
    auth.py        require_staff: verifies the Supabase session, then Authorized_Staff
  agents/
    raise_capacity_priority/      priority agent (see "Raise Capacity priority" below)
      agent.py         evidence -> policy -> Gemini -> validated result
      db_client.py     read-only database client for the ported retrieval modules
      retrieval/ deterministic/ schemas/ pipeline/ integrations/   ported unchanged
      knowledge/raise_capacity/   prioritization_rules, course_offerings, grade_policy
      repository.py    run history + saved fields (agents.raise_capacity_priority_run)
      service.py       states, automatic runs, retry, locking, interrupted runs
    raise_capacity_eligibility/   one folder per agent
      workflow.py  evidence package -> Gemini decision
      decision.py  prompt + decision rules (student identity is not sent)
      schemas.py   Gemini's structured reply
      tools/       request, student, course, capacity, completed_hours,
                   prerequisites (UoS page), grade_policy
      knowledge_base/  grade_policy.json, course_completed_hours.json
      repository.py    run history storage (agents.raise_capacity_evaluation)
      service.py       first-open / rerun behaviour, locking, interrupted runs
      review.py        data for the review page
  api/raise_capacity_review.py    staff routes (eligibility review)
  api/raise_capacity_priority.py  staff routes (priority column)
tests/             offline unit tests (no network, database or Gemini)
  priority_agent/  the prioritization agent's ported tests + backend tests
```

A future agent gets its own folder under `app/agents/` and reuses `app/core`.

## Setup

```
py -3.14 -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt
copy .env.example .env      # then fill in; .env is never committed
.venv/Scripts/python -m pytest
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

The shared Supabase project is already configured for this backend: the dedicated
`smart_uos_backend` role, its read access, the `agents` schema (eligibility and priority run
history) and the priority save function all exist. Nothing needs to be installed. The scripts
that made these changes are kept locally by the project owner, not in this repository.

`DATABASE_URL` must connect as `smart_uos_backend`, never as `postgres` or with the
service_role key. Ask the project owner for that role's connection details; never share them
in chat or commit them.

Optional: `GEMINI_FALLBACK_MODELS` (comma-separated). Only the priority agent uses it, and
only after a temporary Gemini error (HTTP 429 or 503) on the previous model.

## API (staff only)

Every route first verifies the caller's Supabase session (`Authorization: Bearer
<access token>`) with Supabase Auth, then requires an `Authorized_Staff` link:
401 without a valid session, 403 for non-staff.

| Route | Behaviour |
|---|---|
| `GET /api/staff/raise-capacity/{request_id}/review` | Request, student, transcript (relevant rows flagged) and evaluation state. Never runs the agent. |
| `POST /api/staff/raise-capacity/{request_id}/evaluations` `{"rerun": false}` | First opening: runs the agent only if the request has no evaluation yet; otherwise returns the saved one. |
| `POST …/evaluations` `{"rerun": true}` | Runs again, whatever the recommendation. 409 while another run is in progress. |
| `GET /api/staff/raise-capacity/priorities?request_id=…` (1–100) | Each request's priority state. Never runs the agent. |
| `POST /api/staff/raise-capacity/priorities/automatic` `{"request_ids": [...]}` | Starts checks for eligible requests (see below), up to 2 at a time per backend process; returns every state and the IDs it started. Call again while some are `not_started` or `running`. |
| `POST /api/staff/raise-capacity/{request_id}/priority/retry` | Manual retry after a failed or interrupted check. 409 otherwise, 429 while this process is busy. |
| `GET /api/health` | Liveness, no data. |

Evaluation state: `current` is the newest successful result (a Gemini decision; a
Gemini-unavailable MANUAL_REVIEW only if no Gemini decision exists). A newer failed,
interrupted, running or Gemini-unavailable attempt is reported separately as
`latest_attempt`, so a failed rerun never hides the last good result. Only one run per
request can be in progress across all backend processes (advisory lock + unique
index); a run still marked running after 10 minutes is treated as interrupted.

The recommendation is advisory. Nothing in the backend approves, rejects or changes a
request.

## Raise Capacity eligibility rules

Unchanged from the standalone prototype, a separate repository (`APPROVE` / `REJECT` / `MANUAL_REVIEW`, decided by Gemini
from Python-verified evidence; missing evidence is never a rejection). Changes made when
porting:

- Completed-hours lookup normalizes `Course_ID` (text in the database, integer in the
  knowledge base). The prototype never matched, so configured rules were never applied.
- A student with no recorded completed hours makes an applicable rule unresolved
  (MANUAL_REVIEW), instead of crashing.
- The UoS prerequisite page is cached for one hour, then fetched again.
- The student's ID and name are not sent to Gemini (they are kept in the stored evidence).
- **Limitation:** prerequisites come only from the UoS Computer Science degree page.
  Courses not listed there are reported as unverified (MANUAL_REVIEW), and every
  evidence package states this scope.

## Raise Capacity priority

Ported from the standalone prioritization agent (a separate repository). The prioritization
rules, system instruction, knowledge files and evidence logic are unchanged (`HIGH` /
`MEDIUM` / `LOW` / `MANUAL_REVIEW`, decided by Gemini from Python-computed evidence). Changes
made when porting:

- Reads through `smart_uos_backend` (`db_client.py`) instead of supabase-py with the
  service_role key. Values arrive as PostgREST returned them, so the ported code is unchanged.
- The student's ID is not sent to Gemini; the student's justification still is.
- The UoS degree page is cached for one hour.
- A technical failure (database, UoS page, Gemini, invalid reply) is a failed run, never a
  priority.

**Saved value:** `Raise_Capacity."Priority_Level"` + `"Priority_Result"`, in the shape the
agent has always stored. Run history is kept in `agents.raise_capacity_priority_run`.

| State | Meaning | Automatic run | Retry |
|---|---|---|---|
| `saved` | Both fields hold a valid result (from this backend or saved earlier) | No | No |
| `needs_attention` | Only one field filled, unknown level (e.g. `High`), malformed details, details for another level or request; or an earlier run finished but both fields are empty again | No | No |
| `running` | A check is in progress | — | No |
| `failed` | The latest check failed or was interrupted (still running after 10 minutes) | No | Yes, In Progress requests |
| `not_started` | No saved value and no check yet | In Progress requests only | No |
| `not_found` | Unknown ID or not a Raise Capacity request | No | No |

- **Saving:** only `agents.save_raise_capacity_priority`, which validates the result and,
  in one transaction, writes both fields and completes the run, **only when both fields are
  NULL**. If a value appeared meanwhile, the value is kept and the run is `discarded`.
- **Duplicates:** one run per request across all backend processes (advisory lock + unique
  index).
- **Failed reads** answer 503; they are never shown or treated as "no priority".
- **Senior backend:** it connects as `postgres` and can still overwrite these fields
  directly; this backend cannot prevent that. Its values are shown like any other: valid
  ones as `saved`, others as `needs_attention`.

**Verification status (12 October):**
- **Browser-tested on the shared project:** saved priorities display, and failure handling (failed check with Retry, "Unavailable" with Try again).
- **Tested locally with a fake Gemini:** the full flow on a copy of the shared database (automatic checks, saving, reuse, retry, interrupted runs, failed reads, concurrency).
- **Not yet verified:** a successful live priority calculation. The live check for the request ending in 58 failed because Gemini returned 503 (unavailable). It is recorded as a failed run and can be retried from the list.

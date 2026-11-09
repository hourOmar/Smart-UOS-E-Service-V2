# Smart UoS E-Service

A web application for University of Sharjah students to submit academic service requests and
track them, and for authorized staff to review those requests with the help of AI agents and
record the final decision.

**Objectives**

- One place for students to request academic services, upload supporting documents and follow
  each request to its decision.
- Consistent, auditable review for staff: request details, evidence and an advisory AI
  recommendation on one page, with the final decision always made by an authorized person.
- Strict data protection: database policies decide who can see or change what; credentials and
  AI keys never reach the browser.

More detail: [frontend/README.md](frontend/README.md) · [backend/README.md](backend/README.md)

---

## Academic request types

| Service | Student form | Staff review page | AI agents |
|---|---|---|---|
| **Raise Capacity** | Yes | Yes, with decision | Academic Eligibility Evaluation Agent; Prioritization Agent |
| **Program Change** | Yes | Yes, with decision | Program Change Eligibility Agent |
| **Incomplete Exam** (final exams only) | Yes, with optional PDF proofs | Yes, with decision | Incomplete Exam Eligibility Agent; Rejection Explanation Agent |
| **Course Equivalency** | Not yet (catalog entry only) | Listed, no review page | — |
| **Course Substitution** | Not yet (catalog entry only) | Listed, no review page | — |

Midterm exams belong to a separate service and are not part of Incomplete Exam.

---

## Technology stack

| Part | Technology |
|---|---|
| Frontend | React 19, TypeScript 6, Vite 8, React Router 7, `@supabase/supabase-js` 2 |
| Backend | Python 3.14, FastAPI, Uvicorn, SQLAlchemy 2 with psycopg 3, Google Gen AI SDK (Gemini), Requests |
| Data and sign-in | The team's shared Supabase project: PostgreSQL with row-level security, Supabase Auth, private Supabase Storage |
| Tests | Node's built-in test runner (frontend), pytest (backend) |

---

## Architecture

```
 Browser (React app, anon key only)
   │  sign-in, reads, submissions, decisions ──────────────► Supabase (Auth, PostgreSQL with
   │  (database policies and database functions)              row-level security, private Storage)
   │                                                               ▲
   │  /api/... with the staff member's session token               │ read-only role smart_uos_backend
   ▼                                                               │ + staff session for proof files
 FastAPI backend (staff only) ─────────────────────────────────────┘
   │  evidence, deterministic checks, run history
   ▼
 Google Gemini (advisory recommendations and suggested explanations)
```

- The **frontend** talks to Supabase directly with the public anon key; what each user can do
  is enforced by database policies and database functions.
- The **backend** serves staff-only AI features. It verifies the staff member's Supabase session,
  reads data through the restricted `smart_uos_backend` role and stores every AI run in the
  `agents` schema.
- **Final decisions** are recorded by database functions called from the review pages with the
  staff member's own session; the backend never approves or rejects anything.

---

## AI agents

| Agent | Request type | Runs when | Result |
|---|---|---|---|
| Academic Eligibility Evaluation Agent | Raise Capacity | First time staff open a request that was never evaluated; on "Re-run eligibility check" | APPROVE / REJECT / MANUAL_REVIEW, with evidence |
| Prioritization Agent | Raise Capacity | Automatically for visible In Progress requests without a priority; manual retry after a failure | HIGH / MEDIUM / LOW / MANUAL_REVIEW, shown in a Priority column |
| Program Change Eligibility Agent | Program Change | First time staff open a request that was never evaluated; on re-evaluation | APPROVE / REJECT / REQUIRES_REVIEW, with an assessment |
| Incomplete Exam Eligibility Agent | Incomplete Exam | Only when staff click **Run Evaluation** or **Re-evaluate** | APPROVE / REJECT / MANUAL_REVIEW, with per-check explanations; reads the attached PDF proofs |
| Rejection Explanation Agent | Incomplete Exam | Automatically in the same run, **only after a REJECT** | Verified and AI-assessed rejection reasons, and three suggested explanations staff can edit |

Every agent collects the evidence in Python first (request data, enrolment, deadlines, grades,
proofs) and runs deterministic checks; Gemini then writes the assessment. All results are
**advisory** and are stored as a run history; a technical failure is recorded as a failed run,
never as a recommendation. The AI reads uploaded documents but **does not verify that they are
authentic**. See [backend/README.md](backend/README.md) for each agent.

---

## Workflows

**Student**
1. Sign in and open the dashboard, then a service from the catalog.
2. Submit a Raise Capacity, Program Change or Incomplete Exam request. For Incomplete Exam,
   choose an enrolled course section of the current term, enter the date and time of the missed
   final exam and an explanation, and optionally attach up to 5 PDFs (10 MB each, 18 MB in
   total). Files are uploaded before the request is created and cannot be changed afterwards.
3. Follow the request in **My Requests**; the details page shows the submitted information,
   supporting documents, progress and, once decided, the decision and the staff explanation.

**Staff (accounts linked in `Authorized_Staff`)**
1. Sign in to the admin home: search, request-type cards and pending requests.
2. Open a request list by type, then **Review** (Raise Capacity, Program Change, Incomplete Exam).
3. Read the request, the student's record and the advisory AI evaluation; open proof documents
   privately; run or re-run the evaluation where available.
4. Approve or reject with a written explanation and confirm. The request becomes Completed or
   Rejected only through this decision, and the student is notified.

---

## Database and Supabase requirements

The application uses the team's **shared Supabase project**, which is already configured. A new
teammate does not install anything in the database. The project must provide:

- **Tables** for requests and their type-specific details, students, staff (`Authorized_Staff`),
  courses, sections, enrolments (`Takes`), decisions and request history.
- **Row-level security and policies:** students read only their own records; staff read what
  they review; nobody changes a request status directly.
- **Database functions** used by the frontend: `submit_raise_capacity_request`,
  `submit_program_change_request`, `reserve_incomplete_exam_upload`,
  `submit_incomplete_exam_request`, `decide_raise_capacity_request`,
  `decide_program_change_request`, `decide_incomplete_exam_request`, and the student decision
  views `get_my_raise_capacity_rejection`, `get_my_program_change_decision`,
  `get_my_incomplete_exam_decision`.
- **The backend role** `smart_uos_backend` (read-only access to the data the agents need) and the
  **`agents` schema** for run history: `raise_capacity_evaluation`, `raise_capacity_priority_run`,
  `program_change_evaluation`, `incomplete_exam_evaluation`, plus the function
  `agents.save_raise_capacity_priority`.
- **Private Storage bucket `incomplete-exam-proofs`**: staff may read all proofs, students only
  their own; students may upload PDFs (10 MB each) only into their own open upload reservation;
  no one can replace or delete a file. The project's global Storage upload limit must be at least
  10 MB.

The SQL scripts that created and verified these objects are kept **locally by the project owner
and are not in this repository**. Ask the project owner if the database needs to change.

---

## Security

- The frontend holds only the public anon key; the backend holds the database connection
  (`smart_uos_backend`, never `postgres` or the service_role key) and the Gemini key.
- Every backend route verifies the Supabase session and the `Authorized_Staff` link (401 / 403).
- Proof documents are read with the signed-in user's own session under Storage policies; no
  public or signed links are created.
- **AI recommendations are advisory.** Agents never change a request. Only authorized staff
  finalize requests, through database decision functions; staff may decide differently from the
  AI, and the review pages show the recommendation separately from the decision.
- The Raise Capacity and Incomplete Exam agents do not send the student's ID or name to Gemini,
  and the Incomplete Exam agents' AI text is checked by an output safeguard before it is stored.

---

## How to run the complete project (Windows CMD)

### Prerequisites

- **Git**, **VS Code**, **Node.js 22.18 or newer** (tested with Node 24) and **Python 3.14**
  (installed with the `py` launcher).
- Access to the shared Supabase project and, for AI features, a Gemini API key. Ask the project
  owner for the Supabase project URL and anon key, the `smart_uos_backend` connection string and
  a staff or student test account.

### 1. Clone the repository and open it

```cmd
git clone https://github.com/hourOmar/Smart-UOS-E-Service-V2.git
cd Smart-UOS-E-Service-V2
code .
```

### 2. Frontend: install and configure

```cmd
cd frontend
npm install
copy .env.example .env.local
notepad .env.local
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see [frontend/.env.example](frontend/.env.example)).

### 3. Backend: virtual environment, dependencies and configuration

```cmd
cd ..\backend
py -3.14 -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
copy .env.example .env
notepad .env
```

Fill in `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `GEMINI_API_KEY` (see
[backend/.env.example](backend/.env.example)). `requirements-dev.txt` installs the application
dependencies plus the test tools.

### 4. Start the backend (terminal 1)

```cmd
cd backend
.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

Run this from the repository folder (or skip `cd backend` if you are already in it). Check it at
http://127.0.0.1:8000/api/health.

### 5. Start the frontend (terminal 2)

Open a second terminal in VS Code (**Terminal → New Terminal**), from the repository folder:

```cmd
cd frontend
npm run dev
```

### 6. Open the application

Go to **http://localhost:5173** and sign in with a student or staff account.

**Why both servers?** Sign-in, student pages, submissions and decisions talk to Supabase
directly, so they work with only the frontend running. AI evaluations, priorities and
staff-only evaluation data come from the backend: in development the Vite server forwards
every `/api/...` call to `http://127.0.0.1:8000`, so the backend must be running for the review
pages' AI panels and the Priority column.

### 7. Run the tests

From the repository folder:

```cmd
cd frontend
npm test
npm run lint
npm run build
cd ..\backend
.venv\Scripts\python -m pytest
```

All tests run offline (no Supabase, Storage or Gemini calls).

### Troubleshooting

| Problem | What to check |
|---|---|
| Blank page; the browser console says "Missing Supabase environment variables" | `frontend\.env.local` exists with both `VITE_SUPABASE_*` values; restart `npm run dev` after editing it. |
| `'py' is not recognized` | Install Python 3.14 from python.org with the "py launcher" option, then open a new terminal. |
| A review page says the evaluation service could not be reached, or the frontend terminal shows a proxy error | The backend is not running on port 8000. Start it (step 4). |
| The backend answers 401 or 403 | Sign out and in again; `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `backend\.env` must belong to the same project as the frontend; the account must be linked in `Authorized_Staff`. |
| The backend answers 503 ("could not be loaded") | `DATABASE_URL` is missing or wrong; it must connect as `smart_uos_backend`. |
| An evaluation fails with "The AI service (Gemini) was unavailable" | `GEMINI_API_KEY` is missing or invalid, or Gemini is busy; try again later. |
| Port 8000 is already in use | Stop the other process. If you change the port, also change the proxy target in `frontend\vite.config.ts`. |
| CORS error when the frontend uses `VITE_API_BASE_URL` | Add the frontend's origin to `FRONTEND_ORIGINS` in `backend\.env`. |
| A student account is sent back to the sign-in page | The account must exist in `Student` (matched by email) and be linked to its sign-in account. |
| A PDF upload is refused as too large | Files over 10 MB are refused; the project's global Storage upload limit must be at least 10 MB. |

---

## Known limitations

- **Incomplete Exam is limited to final exams by the student form only.** The database functions
  still accept a midterm exam type if called directly.
- The AI does not verify that uploaded documents are authentic; staff must check them.
- Course Equivalency and Course Substitution have no submission form or review page yet, and
  their service details pages (and Program Change's) have no content yet.
- The current academic term for request forms is fixed in `frontend/src/config/academicTerm.ts`.
- Supporting documents cannot be added after an Incomplete Exam request is submitted (by design).
- The Raise Capacity eligibility agent verifies prerequisites only from the UoS Computer Science
  degree page.
- The database scripts are not in this repository, so a new database cannot be set up from it.
- There is no end-to-end browser test suite; frontend tests cover logic and source rules.

---

## Repository structure

```
frontend/   React application (see frontend/README.md)
backend/    FastAPI backend and AI agents (see backend/README.md)
```

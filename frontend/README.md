# Smart UoS E-Service — Frontend

React single-page application for students and staff. For the project overview, setup of the
whole system and troubleshooting, see the [main README](../README.md).

## Stack

- React 19 + TypeScript 6, built with Vite 8
- React Router 7 (client-side routing)
- `@supabase/supabase-js` 2 (sign-in, database reads, database functions, Storage)
- ESLint 10 with typescript-eslint and the React Hooks and React Refresh plugins
- Tests: Node's built-in test runner (`node --test`), running the TypeScript test files directly
  (Node.js 22.18 or newer)

## Structure

```
src/
  App.tsx          routes (see below)
  main.tsx         entry point
  pages/           one component per route (sign-in, student, admin)
  components/
    ProtectedRoute.tsx    role check for every page except sign-in
    student/              student layout, navigation, catalog and dashboard parts
    admin/                admin search, request-type cards, pending requests, pager,
                          Priority cell, Review button
    requests/             request details parts (status badge, supporting documents)
    raiseCapacity/        Raise Capacity form parts
    programChange/        Program Change form parts
    incompleteExam/       Incomplete Exam form parts (course picker, PDF field)
    review/               Raise Capacity review panels (evidence, eligibility, decision)
    programChangeReview/  Program Change review panels
    incompleteExamReview/ Incomplete Exam review panels (proofs, evaluation, decision)
  services/        all Supabase queries and backend calls (supabase.ts is the only client)
  hooks/           data hooks used by the pages
  utils/           pure logic (validation, status labels, paths, submission flow); unit-tested
  data/            fixed catalog content (academicRequests.ts)
  config/          academicTerm.ts (current term), api.ts (backend base URL)
tests/             *.test.ts, run with npm test
```

## Routes

| Route | Page | Who |
|---|---|---|
| `/` | Sign in | Everyone |
| `/student` | Dashboard: service catalog, recent requests | Student |
| `/student/services/:serviceId` | Service details | Student |
| `/student/services/raise-capacity/new` | Raise Capacity form | Student |
| `/student/services/program-change/new` | Program Change form | Student |
| `/student/services/incomplete-exam/new` | Incomplete Exam form | Student |
| `/student/requests` | My Requests | Student |
| `/student/requests/:requestId` | Request details | Student |
| `/student/profile` | My Profile | Student |
| `/admin` | Admin home: search, request-type cards, pending requests | Staff |
| `/admin/requests/:typeId` | Request list by type (status tabs, search, pagination) | Staff |
| `/admin/requests/raise-capacity/:requestId` | Raise Capacity review | Staff |
| `/admin/requests/program-change/:requestId` | Program Change review | Staff |
| `/admin/requests/incomplete-exam/:requestId` | Incomplete Exam review | Staff |

## Authentication and protected routes

Sign-in uses Supabase Auth. `ProtectedRoute` checks the signed-in user on every protected page:
an account linked in `Authorized_Staff` is staff; otherwise an account whose email matches a
`Student` record is a student. Users without a role are sent to `/`; users on the other role's
pages are redirected to their own home. This only shapes the interface: every read and write is
still enforced by database policies and functions, and every backend route checks staff access
itself.

## Request workflows

All submissions go through database functions, which identify the student from the session and
validate everything again:

- **Raise Capacity:** choose a section of the current term and give a justification;
  `submit_raise_capacity_request`.
- **Program Change:** choose a college and a program and give a reason;
  `submit_program_change_request`.
- **Incomplete Exam (final exams only):** choose one of the student's own enrolled sections of the
  current term, the missed exam's date (not in the future, UAE date) and time, a reason
  (20–1000 characters) and an optional description of the evidence (up to 500). A note appears
  when the exam was more than four working days ago; it does not block submission.
  `Exam_Type` is always sent as `Final`.

The request details page shows the submitted fields, progress, supporting documents and, once
decided, the decision and the staff explanation (`get_my_raise_capacity_rejection`,
`get_my_program_change_decision`, `get_my_incomplete_exam_decision`). An Incomplete Exam request
reads as "Approved" only when an approval decision record exists.

## Staff review interfaces

Each review page shows the request, the student, the relevant evidence and the advisory AI
result, then a decision panel (Approve or Reject, an explanation of 1–2000 characters,
confirmation) saved by `decide_raise_capacity_request`, `decide_program_change_request` or
`decide_incomplete_exam_request` with the staff member's own session.

- **Raise Capacity:** eligibility recommendation with evidence; the first opening of a request
  that was never evaluated runs the check once; a Priority column appears in the lists.
- **Program Change:** eligibility assessment; first evaluation on first opening, re-evaluation on
  request.
- **Incomplete Exam:** proof documents (open or download on click), the eligibility
  recommendation and per-check explanations, technical failures shown separately, a warning that
  the AI does not verify document authenticity and, after a REJECT, suggested explanations with
  "Use this reason". Reasons are shown as **Verified reasons** (deterministic checks) and
  **Assessed reasons** (the AI's judgment). Evaluations run only when staff click **Run
  Evaluation** or **Re-evaluate**.

## Communication with Supabase and the backend

- `services/supabase.ts` creates the only Supabase client, from `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`. Every query runs with the signed-in user's session.
- `services/backendApi.ts` calls the FastAPI backend at `VITE_API_BASE_URL` + `/api/...`, sending
  the user's access token as `Authorization: Bearer …`. In development `VITE_API_BASE_URL` is
  empty and `vite.config.ts` proxies `/api` to `http://127.0.0.1:8000`.
- While an evaluation runs, review pages re-read the saved state every few seconds, for a limited
  time; they never start a second run.

## Supporting documents (Incomplete Exam)

- **Upload, before the request exists:** the student selects 0–5 PDFs. Each is checked in the
  browser (`.pdf` name, `application/pdf` type, `%PDF-` signature, 10 MB per file, 18 MB in
  total). On Submit, the form reserves an upload (`reserve_incomplete_exam_upload`), uploads each
  file to the private `incomplete-exam-proofs` bucket under `<reserved ID>/<random>-<name>.pdf`
  (standard upload, never overwriting), and calls `submit_incomplete_exam_request` **only when
  every file has uploaded**. A file that fails (including "already exists") must be removed and
  selected again. Nothing can be added, replaced or removed after submission.
- **Retrieval:** students (their own files) and staff open or download documents on click. The
  file is downloaded with the user's session, its type and contents are checked, and the browser
  receives a temporary local link that is released when the page closes. No public or signed
  links are created.

## Environment variables

Copy `.env.example` to `.env.local` (never committed). Everything here is built into the browser
bundle, so it must never contain a secret.

| Variable | Required | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase public anon key |
| `VITE_API_BASE_URL` | No | Backend base URL for a deployment; leave empty in development |

The current academic term for request forms is set in `src/config/academicTerm.ts`.

## Commands (Windows CMD, in the `frontend` folder)

| Command | Purpose |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Development server on http://localhost:5173 |
| `npm test` | Unit and source-rule tests |
| `npm run lint` | ESLint |
| `npm run build` | Typecheck (`tsc -b`) and production build into `dist\` |
| `npm run preview` | Serve the production build locally |

## Known limitations

- Incomplete Exam is limited to final exams by this form; the database still accepts other exam
  types if called directly.
- Roles are detected by the `Authorized_Staff` link and by student email in `ProtectedRoute`; the
  database functions identify students by their sign-in account, so both must match.
- Some browsers report an empty file type for PDFs; such files are refused by the PDF check.
- No end-to-end or component (DOM) tests; tests cover logic in `src/utils` and source rules.
- The production build is one JavaScript bundle (Vite warns that it is over 500 kB).
- Course Equivalency and Course Substitution have no form yet.

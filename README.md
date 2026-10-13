# Smart UoS E-Service

A web app for University of Sharjah students to request academic services and track their requests, and for staff to review them.

- **Frontend:** React + TypeScript + Vite, in `frontend/`.
- **Database and sign-in:** the team's shared Supabase project. It is already set up for this app (tables, access policies, database functions and the backend's own role), so there is nothing to install. The frontend uses only the public anon key; access is enforced by database policies. The scripts used to make and verify those database changes are kept locally by the project owner and are not part of this repository; ask them if the database needs to change.
- **Backend:** Python (FastAPI), in `backend/`, for staff-only features that need server-side credentials. It holds the Raise Capacity eligibility agent and the Raise Capacity priority agent (see [backend/README.md](backend/README.md)). The admin review page calls it at `/api/...`; in development, Vite proxies `/api` to `http://127.0.0.1:8000`, so start the backend before using the review page or the Priority column.

## Running the frontend

```bash
cd frontend
npm install
npm run dev      # development server
npm run build    # typecheck + production build
npm run lint
```

`frontend/.env.local` (not committed) must define:

```
VITE_SUPABASE_URL=<shared project URL>
VITE_SUPABASE_ANON_KEY=<shared project anon / publishable key>
```

Never put a service_role key or database password in the frontend.

## What works

**Students:**
- Sign in.
- The dashboard, with the service catalog and recent requests.
- Each service's details page.
- **Raise Capacity** submission, through `submit_raise_capacity_request`.
- **My Requests** and the request details page.

**Staff:** these are accounts linked in `Authorized_Staff`.
- Admin home: search by student or request ID, request-type cards with counts, and pending requests.
- Per-type request lists with status tabs, search and pagination.
- **Priority column** (staff only) in Pending Requests and the Raise Capacity list, from the backend's priority
  agent. Pagination and ordering are unchanged.
  - Saved priorities show as High, Medium, Low or Manual review, and reopening reuses them.
  - Checks start automatically only for visible In Progress Raise Capacity requests with no saved priority and no
    earlier check; the column shows "Checking…" or "Queued…" until they finish (at most two at a time per backend).
  - "Check failed" / "Check interrupted" offers **Retry**; nothing is retried automatically.
  - "Needs attention" marks partial or malformed saved values (hover for the reason); they are never rerun or
    overwritten. "Not checked" marks finalized requests without a priority.
  - If priorities can't be read, cells show "Unavailable" with one **Try again** above the table; the page does not
    keep retrying.
  - Other request types show "—". Student pages never show or request priorities.
  - **Tested (12 October):** in the browser against the shared project, the display of saved priorities and the
    failure handling ("Check failed", Retry, "Unavailable") work. Locally, with a fake Gemini, the whole flow passed
    (automatic checks, reuse, retry, interrupted checks, failed reads). **Not yet verified:** a successful live
    priority calculation. The live check for the request ending in 58 failed because Gemini returned 503
    (unavailable); retry it when Gemini is available.
- **Raise Capacity review page** (Review in either list), with:
  - the request, the student and the relevant current transcript;
  - the advisory eligibility recommendation with its evidence snapshot;
  - "Re-run eligibility check".

  The first opening of a request that was never evaluated runs the check once. Later openings show the saved result.

- **Staff decision** on that page:
  - Approve or Reject with a required explanation (1–2000 characters), then a confirmation step, saved by `decide_raise_capacity_request` with the staff member's session.
  - Approval allocates one seat (`Current_Capacity + 1`) and does not register the student.
  - Decided requests show the decision, explanation, staff member and date instead of the controls.
  - The eligibility recommendation stays advisory.

Review stays disabled for other request types.

**Catalog services:** Raise Capacity, Incomplete Exam, **Course Substitution**, Program Change and Course Equivalency. Only Raise Capacity has a submission form so far; the others show "Start request" disabled.

Course Substitution replaced Grade Change, which does not exist in the shared database. It uses the `Course_Substitution` table (original course, proposed course, reason).

**Service details pages:** all five use one template, with the same summary strip, accordion sections and "Before you submit" box.
- Only Raise Capacity has content.
- The other four keep every heading but show no text until the university supplies their content (`frontend/src/data/academicRequests.ts`).

The current term for request forms is set in `frontend/src/config/academicTerm.ts`.

## Layout

```
frontend/src/
  pages/        route pages (login, student, admin)
  components/   shared layout, student, admin, requests, raiseCapacity
  services/     Supabase queries (supabase.ts is the only client)
  hooks/        data hooks used by the pages
  data/         fixed catalog content (academicRequests.ts)
  config/ utils/ assets/
backend/
  app/core/     shared database, Gemini and staff-auth modules
  app/agents/   one folder per agent (raise_capacity_eligibility, raise_capacity_priority)
  app/api/      staff-only routes
```

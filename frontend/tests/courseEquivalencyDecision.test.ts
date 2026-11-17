// The administrator's final Course Equivalency decision (decision only) and the student's
// view of it:
// - the readiness rules (a completed, current evaluation is required; running, missing,
//   failed and outdated evaluations block the decision), the override rule and the refusal
//   messages, mirrored from the database function;
// - the staff decision record (the Decision row only) and the student's decision view;
// - static guarantees of the page, panel and services (session-only identity, explicit
//   override confirmation, the limitation shown, no transcript or academic-record writes);
// - static guarantees of the SQL scripts (security settings, permissions, one decision per
//   request, the status guard, no academic-record writes, the rehearsal always rolls back).
// The database behaviour itself is exercised by
// database/maintenance/course-equivalency-decision/07_rehearsal_rollback_only.sql.
// Run: npm test (no browser, backend or database).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  ACADEMIC_RECORD_LIMITATION,
  COURSE_EQUIVALENCY_DECISION_MESSAGES,
  COURSE_EQUIVALENCY_DECISION_TYPES,
  READINESS_MESSAGES,
  UNKNOWN_DECISION_MESSAGE,
  courseEquivalencyDecisionErrorCode,
  courseEquivalencyDecisionErrorMessage,
  decisionReadiness,
  explanationError,
  isOverride,
  toCourseEquivalencyDecisionRecord,
} from '../src/utils/courseEquivalencyDecision.ts'
import type { CourseEquivalencyEvaluationState, CourseEquivalencyRun } from '../src/utils/courseEquivalencyEvaluation.ts'
import { buildCourseEquivalencyRecord } from '../src/utils/courseEquivalencyRecord.ts'
import { toCourseEquivalencyDecisionView } from '../src/utils/courseEquivalencyStudentDecision.ts'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const PAGE = source('../src/pages/AdminCourseEquivalencyReview.tsx')
const PANEL = source('../src/components/courseEquivalencyReview/DecisionPanel.tsx')
const SERVICE = source('../src/services/courseEquivalencyReview.ts')
const STUDENT_SERVICE = source('../src/services/courseEquivalencyStudent.ts')
const STUDENT_PAGE = source('../src/pages/StudentRequestDetails.tsx')
const STUDENT_REQUESTS = source('../src/services/studentRequests.ts')
const CS_SERVICE = source('../src/services/courseSubstitutionReview.ts')
const SQL_DIR = '../../database/maintenance/course-equivalency-decision/'
const SQL_INSTALL = source(`${SQL_DIR}01_install.sql`)
const SQL_VERIFY = source(`${SQL_DIR}02_verify.sql`)
const SQL_ROLLBACK = source(`${SQL_DIR}03_rollback.sql`)
const SQL_GUARD = source(`${SQL_DIR}04_status_guard_install.sql`)
const SQL_GUARD_VERIFY = source(`${SQL_DIR}05_status_guard_verify.sql`)
const SQL_GUARD_ROLLBACK = source(`${SQL_DIR}06_status_guard_rollback.sql`)
const SQL_REHEARSAL = source(`${SQL_DIR}07_rehearsal_rollback_only.sql`)
const SQL_PREFLIGHT = source(`${SQL_DIR}00_preflight_readonly.sql`)

const between = (text: string, start: string, end: string) => {
  const from = text.indexOf(start)
  assert.ok(from >= 0, `missing: ${start}`)
  const to = text.indexOf(end, from + start.length)
  assert.ok(to > from, `missing after ${start}: ${end}`)
  return text.slice(from, to)
}
const DECIDE_BODY = between(SQL_INSTALL, 'CREATE FUNCTION public.decide_course_equivalency_request(', '$function$;')
const VIEW_BODY = between(SQL_INSTALL, 'CREATE FUNCTION public.get_my_course_equivalency_decision(', '$function$;')
// SQL without comments and string literals (to check which statements a script runs).
const statements = (sql: string) => sql.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")

// --------------------------------------------------------------------------- fixtures
const SYLLABI = [
  { syllabus_id: '11111111-1111-1111-1111-111111111111', side: 'old' },
  { syllabus_id: '22222222-2222-2222-2222-222222222222', side: 'new' },
]

function run(overrides: Partial<CourseEquivalencyRun> = {}): CourseEquivalencyRun {
  return {
    id: 7,
    run_status: 'completed',
    trigger: 'first_open',
    started_at: '2026-11-17T08:00:00+00:00',
    finished_at: '2026-11-17T08:01:00+00:00',
    recommendation: 'APPROVE',
    reasoning: 'Equivalent.',
    check_explanations: [],
    deterministic_results: null,
    evidence: null,
    evaluated_syllabi: SYLLABI as never,
    outdated: false,
    outdated_sides: [],
    rejection_explanation: null,
    assessment_model: 'model',
    rejection_model: null,
    agent_version: '1.0.0',
    failure_kind: null,
    error_message: null,
    ...overrides,
  }
}

function state(overrides: Partial<CourseEquivalencyEvaluationState> = {}): CourseEquivalencyEvaluationState {
  return {
    request_id: 'STUD_EQVO_ECTU_000001',
    request_status: 'In Progress',
    details_missing: false,
    details_missing_message: null,
    syllabi_ready: true,
    syllabi_missing_message: null,
    current_syllabi: { old: SYLLABI[0].syllabus_id, new: SYLLABI[1].syllabus_id },
    policy_status: null,
    current: run(),
    latest_attempt: null,
    in_progress: false,
    run_count: 1,
    current_syllabus_sources: { old: 'staff_upload', new: 'staff_upload' },
    first_run_eligible: false,
    auto_run_eligible: false,
    manual_start_reason: null,
    can_rerun: true,
    ...overrides,
  }
}

const ready = (data: CourseEquivalencyEvaluationState | null, running = false, status: 'loading' | 'ready' | 'error' = 'ready') =>
  decisionReadiness({ status, data, running })

// --------------------------------------------------------------------------- readiness
test('a completed, current latest evaluation makes the decision possible, on that evaluation', () => {
  const r = ready(state())
  assert.equal(r.ready, true)
  if (r.ready) {
    assert.equal(r.run.id, 7)
    assert.equal(r.recommendation, 'APPROVE')
  }
})

test('a failed, interrupted or running latest re-evaluation blocks the decision despite an older completed one', () => {
  const blocker = (r: ReturnType<typeof ready>) => (r.ready ? 'ready' : r.blocker)
  const failed = run({ id: 9, run_status: 'failed', recommendation: null, failure_kind: 'technical' })
  const interrupted = run({ id: 9, run_status: 'interrupted', recommendation: null, failure_kind: 'interrupted' })
  const running = run({ id: 9, run_status: 'running', recommendation: null })
  assert.equal(blocker(ready(state({ latest_attempt: failed }))), 'failed')
  assert.equal(blocker(ready(state({ latest_attempt: interrupted }))), 'failed')
  assert.equal(blocker(ready(state({ latest_attempt: running }))), 'running')
  assert.equal(blocker(ready(state({ latest_attempt: running, in_progress: true }))), 'running')
  assert.match(READINESS_MESSAGES.failed ?? '', /wait for a successful result/)
  // The same rule in the database: the newest run of any status must be completed.
  assert.match(DECIDE_BODY, /from agents\.course_equivalency_evaluation e\s+where e\.request_id = p_request_id\s+order by e\.started_at desc, e\.id desc\s+limit 1;/)
  assert.match(DECIDE_BODY, /if v_eval\.run_status is distinct from 'completed' then\s+raise exception using errcode = '55000', message = 'evaluation_failed';/)
  assert.doesNotMatch(DECIDE_BODY, /and e\.run_status = 'completed'/)
})

test('missing, failed, running or outdated evaluations block the decision', () => {
  const blocker = (r: ReturnType<typeof ready>) => (r.ready ? 'ready' : r.blocker)
  assert.equal(blocker(ready(null, false, 'loading')), 'loading')
  assert.equal(blocker(ready(null, false, 'error')), 'unavailable')
  assert.equal(blocker(ready(state({ current: null, run_count: 0 }))), 'missing')
  assert.equal(blocker(ready(state({ current: null, latest_attempt: run({ run_status: 'failed', recommendation: null }) }))), 'failed')
  assert.equal(blocker(ready(state({ current: null, latest_attempt: run({ run_status: 'interrupted', recommendation: null }) }))), 'failed')
  assert.equal(blocker(ready(state({ in_progress: true }))), 'running')
  assert.equal(blocker(ready(state(), true)), 'running')
  assert.equal(blocker(ready(state({ current: run({ outdated: true, outdated_sides: ['new'] }) }))), 'outdated')
  assert.equal(blocker(ready(state({ current: run({ recommendation: null }) }))), 'missing')
  for (const key of ['unavailable', 'running', 'missing', 'failed', 'outdated'] as const) {
    assert.ok((READINESS_MESSAGES[key] ?? '').length > 20, key)
  }
  assert.equal(READINESS_MESSAGES.loading, null)
})

// --------------------------------------------------------------------------- override
test('an override is a decision against a definite recommendation; MANUAL_REVIEW never is', () => {
  assert.equal(isOverride('approve', 'REJECT'), true)
  assert.equal(isOverride('reject', 'APPROVE'), true)
  assert.equal(isOverride('approve', 'APPROVE'), false)
  assert.equal(isOverride('reject', 'REJECT'), false)
  assert.equal(isOverride('approve', 'MANUAL_REVIEW'), false)
  assert.equal(isOverride('reject', 'MANUAL_REVIEW'), false)
  assert.equal(isOverride(null, 'REJECT'), false)
  assert.equal(isOverride('approve', null), false)
  // The same rule in the database function.
  assert.match(DECIDE_BODY, /v_override := \(v_decision = 'approve' and v_eval\.recommendation = 'REJECT'\)\s+or \(v_decision = 'reject' and v_eval\.recommendation = 'APPROVE'\);/)
})

// --------------------------------------------------------------------------- explanation and refusals
test('an explanation is required for approval and rejection, at most 2000 characters', () => {
  assert.equal(explanationError('', true), 'Enter an explanation for the student.')
  assert.equal(explanationError('   ', true), 'Enter an explanation for the student.')
  assert.equal(explanationError('x'.repeat(2000), true), null)
  assert.match(explanationError('x'.repeat(2001), true) ?? '', /at most 2,000/)
  assert.match(DECIDE_BODY, /if v_explanation = '' then\s+raise exception using errcode = '22023', message = 'explanation_required';/)
  assert.match(DECIDE_BODY, /if char_length\(v_explanation\) > 2000 then/)
  // The same rule for both outcomes: checked before the outcome is used.
  assert.ok(DECIDE_BODY.indexOf("message = 'explanation_required'") < DECIDE_BODY.indexOf("if v_decision = 'approve' then"))
})

test('every refusal of the database function has a staff-facing message', () => {
  const codes = [...DECIDE_BODY.matchAll(/message = '([a-z_]+)'/g)].map((m) => m[1])
  assert.ok(codes.length >= 15)
  for (const code of codes) {
    assert.ok(Object.hasOwn(COURSE_EQUIVALENCY_DECISION_MESSAGES, code), `no message for ${code}`)
    assert.equal(courseEquivalencyDecisionErrorCode({ message: code }), code)
    assert.equal(courseEquivalencyDecisionErrorMessage(code), COURSE_EQUIVALENCY_DECISION_MESSAGES[code])
  }
  assert.equal(courseEquivalencyDecisionErrorCode({ message: 'JWT expired' }), 'signed_out')
  assert.equal(courseEquivalencyDecisionErrorCode({ code: 'PGRST301' }), 'signed_out')
  assert.equal(courseEquivalencyDecisionErrorCode({ message: 'permission denied for function x' }), 'signed_out')
  assert.equal(courseEquivalencyDecisionErrorCode({ message: 'boom' }), 'unknown')
  assert.equal(courseEquivalencyDecisionErrorMessage('unknown'), UNKNOWN_DECISION_MESSAGE)
  assert.match(COURSE_EQUIVALENCY_DECISION_MESSAGES.already_decided, /already been decided/)
  assert.match(COURSE_EQUIVALENCY_DECISION_MESSAGES.not_staff, /Only staff/)
})

// --------------------------------------------------------------------------- records
test('the staff decision record comes from a Course Equivalency Decision row only', () => {
  const decision = {
    Decision_ID: 41, Decision_Type: 'Course Equivalency Approved', Decision_Comment: 'Equivalent content.',
    Decision_Date: '2026-11-17 09:30:00', Staff_ID: 3, Authorized_Staff: { Staff_Name: 'Registrar' },
  }
  assert.deepEqual(toCourseEquivalencyDecisionRecord(decision), {
    id: 41, choice: 'approve', explanation: 'Equivalent content.', staffId: 3, staffName: 'Registrar',
    date: '2026-11-17T09:30:00Z',
  })
  assert.equal(toCourseEquivalencyDecisionRecord({ ...decision, Decision_Type: 'Course Equivalency Rejected' })?.choice, 'reject')
  // Another type's decision is never shown as a Course Equivalency decision.
  assert.equal(toCourseEquivalencyDecisionRecord({ ...decision, Decision_Type: 'Course Substitution Approved' }), null)
  assert.equal(toCourseEquivalencyDecisionRecord(null), null)
  assert.deepEqual(COURSE_EQUIVALENCY_DECISION_TYPES, { approve: 'Course Equivalency Approved', reject: 'Course Equivalency Rejected' })

  const record = buildCourseEquivalencyRecord({
    request: { Request_ID: 'R', Request_Type: 'Course Equivalency', Current_Status: 'Completed', Student_ID: 'S' },
    details: null, courses: [], student: null, programChange: null, programChangeRequest: null, history: null,
    decision,
  })
  assert.equal(record.decision?.choice, 'approve')
  assert.equal(record.decision?.explanation, 'Equivalent content.')
  const pending = buildCourseEquivalencyRecord({
    request: { Request_ID: 'R' }, details: null, courses: [], student: null, programChange: null, programChangeRequest: null, history: null,
  })
  assert.equal(pending.decision, null)
})

test('the student sees a decision only with a decision record, never the agent result', () => {
  assert.deepEqual(
    toCourseEquivalencyDecisionView({ decision: 'approve', has_decision_record: true, explanation: ' Approved. ', decided_at: '2026-11-17 09:30:00' }),
    { decision: 'approve', hasDecisionRecord: true, explanation: 'Approved.', decidedAt: '2026-11-17T09:30:00Z' },
  )
  assert.equal(toCourseEquivalencyDecisionView({ decision: 'reject', has_decision_record: true, explanation: 'No.' })?.decision, 'reject')
  for (const data of [
    { decision: 'approve', has_decision_record: false },
    { decision: 'approve' },
    { decision: null, has_decision_record: true },
    null,
    'approve',
  ]) {
    assert.equal(toCourseEquivalencyDecisionView(data), null)
  }
  // The database view: own request only, decided only, record only, no agent data.
  assert.match(VIEW_BODY, /v_student := app_private\.current_student_id\(\);/)
  assert.match(VIEW_BODY, /and r\."Student_ID" = v_student;/)
  assert.match(VIEW_BODY, /v_status not in \('Completed', 'Rejected'\)/)
  assert.doesNotMatch(VIEW_BODY, /when v_status|agents\./)
  assert.match(VIEW_BODY, /STABLE SECURITY DEFINER/)
})

// --------------------------------------------------------------------------- page, panel, services
test('the review page shows the decision panel on the evaluation readiness', () => {
  assert.match(PAGE, /const readiness = decisionReadiness\(\{ status: evaluation\.status, data: evalData, running: evaluation\.running \}\)/)
  assert.match(PAGE, /refreshRecord\(\)\s+refreshEvaluation\(\)/)
  assert.doesNotMatch(PAGE, /not available on this page yet/)
})

test('the panel: approve and reject, required explanation, explicit override confirmation, final confirmation', () => {
  assert.match(PANEL, /value: 'approve',\s+label: 'Approve'/)
  assert.match(PANEL, /value: 'reject', label: 'Reject'/)
  assert.match(PANEL, /if \(!readiness\.ready \|\| !choice \|\| explanationError\(explanation, true\) !== null\) return/)
  assert.match(PANEL, /if \(override && !overrideConfirmed\) return/)
  assert.match(PANEL, /type="checkbox"[\s\S]*I confirm that I am overriding the agent’s recommendation\./)
  // The evaluation reviewed at the confirmation step is the one sent.
  assert.match(PANEL, /setReviewedRunId\(readiness\.run\.id\)/)
  assert.match(PANEL, /decideCourseEquivalencyRequest\(request\.id, choice, explanation, reviewedRunId, override && overrideConfirmed\)/)
  assert.match(PANEL, /Confirm approval/)
  assert.match(PANEL, /Confirm rejection/)
  // Double submission guard.
  assert.match(PANEL, /if \(!choice \|\| reviewedRunId == null \|\| savingRef\.current\) return/)
  // Shows the agent's recommendation, and offers no form without a ready evaluation.
  assert.match(PANEL, /Agent recommendation \(advisory\)/)
  assert.match(PANEL, /!readiness\.ready \? \(/)
  // Finalized requests show the saved decision only.
  assert.match(PANEL, /finalized \? \(\s+<RecordedDecision record=\{record\} \/>/)
})

test('the limitation is explicit: approval does not change the academic record', () => {
  assert.match(ACADEMIC_RECORD_LIMITATION, /administrative decision only/)
  assert.match(ACADEMIC_RECORD_LIMITATION, /transcript/)
  assert.match(ACADEMIC_RECORD_LIMITATION, /credit hours/)
  assert.match(ACADEMIC_RECORD_LIMITATION, /CGPA, completed hours or program/)
  assert.equal(PANEL.match(/\{ACADEMIC_RECORD_LIMITATION\}/g)?.length, 2)   // in the form and on a recorded approval
  assert.match(PANEL, /No transcript entry, credit hours, CGPA, completed hours or program change is made\./)
  assert.match(PANEL, /The transcript was not changed\./)
  // Nothing claims credits were awarded.
  for (const code of [PANEL, PAGE]) assert.doesNotMatch(code, /credits? (were|was|have been|has been) (awarded|added|transferred)/i)
})

test('identity comes from the session only; nothing writes academic records', () => {
  const decide = between(SERVICE, 'export async function decideCourseEquivalencyRequest(', '\n}')
  assert.match(decide, /supabase\.rpc\('decide_course_equivalency_request', \{\s+p_request_id: requestId,\s+p_decision: choice,\s+p_explanation: explanation\.trim\(\),\s+p_evaluation_id: evaluationId,\s+p_confirm_override: confirmOverride,\s+\}\)/)
  for (const code of [SERVICE, PANEL, PAGE, STUDENT_SERVICE]) {
    assert.doesNotMatch(code, /p_staff|staff_id:/i)
    assert.doesNotMatch(code, /\.(insert|update|upsert|delete)\(/)
    assert.doesNotMatch(code, /service_role|SERVICE_ROLE|sb_secret/)
  }
  assert.doesNotMatch(SERVICE, /from\('Takes'\)/)
})

test('students read their own decision through the database function only', () => {
  assert.match(STUDENT_SERVICE, /supabase\.rpc\('get_my_course_equivalency_decision', \{ p_request_id: requestId \}\)/)
  assert.doesNotMatch(STUDENT_SERVICE, /from\('Decision'\)/)
  assert.match(STUDENT_REQUESTS, /\[COURSE_EQUIVALENCY\]: fetchCourseEquivalencyDecision,/)
  assert.match(STUDENT_PAGE, /const showCourseEquivalencyDecision = request\.type === COURSE_EQUIVALENCY && decided/)
  assert.match(STUDENT_PAGE, /useCourseEquivalencyDecision\(request\.id, showCourseEquivalencyDecision\)/)
  assert.match(STUDENT_PAGE, /\{showCourseEquivalencyDecision && \(\s+<DecisionExplanation\s+status=\{courseEquivalency\.status\}\s+explanation=\{courseEquivalency\.decision\?\.explanation\}/)
  // The decision date: from the history, or the decision record.
  assert.match(STUDENT_PAGE, /\{!request\.decision && recordDecidedAt && \(/)
  // Pending requests still show no decision.
  assert.match(STUDENT_PAGE, /<strong>No decision yet\.<\/strong>/)
})

test('the other request types are unchanged', () => {
  assert.match(CS_SERVICE, /supabase\.rpc\('decide_course_substitution_request', \{\s+p_request_id: requestId,\s+p_decision: choice,\s+p_explanation: explanation\.trim\(\),\s+\}\)/)
  for (const sql of [SQL_INSTALL, SQL_GUARD, SQL_ROLLBACK, SQL_GUARD_ROLLBACK]) {
    const code = statements(sql)
    assert.doesNotMatch(code, /CREATE (OR REPLACE )?FUNCTION public\.decide_(course_substitution|program_change|incomplete_exam|raise_capacity)_request/i)
    assert.doesNotMatch(code, /DROP (FUNCTION|POLICY|INDEX)[^;]*(course_substitution|program_change|incomplete_exam|raise_capacity)/i)
    assert.doesNotMatch(code, /ALTER POLICY/i)
  }
})

// --------------------------------------------------------------------------- SQL
test('decision function: security settings and permissions follow the other decision functions', () => {
  assert.match(DECIDE_BODY, /RETURNS jsonb\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path TO ''/)
  assert.match(DECIDE_BODY, /v_staff_id := app_private\.current_staff_id\(\);\s+if v_staff_id is null or not coalesce\(app_private\.can_decide\(\), false\) then\s+raise exception using errcode = '42501', message = 'not_staff';/)
  const sig = 'public.decide_course_equivalency_request(character varying, text, text, bigint, boolean)'
  for (const role of ['PUBLIC', 'anon', 'service_role', 'smart_uos_backend']) {
    assert.ok(SQL_INSTALL.includes(`REVOKE ALL ON FUNCTION ${sig} FROM ${role};`), role)
  }
  assert.ok(SQL_INSTALL.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`))
  assert.doesNotMatch(SQL_INSTALL, /GRANT [^;]* TO (anon|smart_uos_backend|PUBLIC|service_role)\s*;/)
  // Same architecture as the other request types: no new table, policy, trigger or table grant;
  // the decision is stored only in the existing public."Decision".
  const code = statements(SQL_INSTALL)
  assert.doesNotMatch(code, /CREATE (TABLE|POLICY|TRIGGER)|ALTER TABLE|ON TABLE/i)
  assert.equal((DECIDE_BODY.match(/insert into /g) ?? []).length, 1)
  assert.match(DECIDE_BODY, /insert into public\."Decision" \("Decision_Type", "Decision_Comment", "Decision_Date", "Request_ID", "Staff_ID"\)/)
  // The verify script compares grants and settings with the Course Substitution function.
  assert.match(SQL_VERIFY, /'public\.decide_course_substitution_request\(character varying, text, text\)'/)
  assert.match(SQL_VERIFY, /'smart_uos_backend cannot EXECUTE'/)
  assert.match(SQL_VERIFY, /'anon cannot EXECUTE'/)
})

test('decision function: one transaction, In Progress only, locked, one decision per request', () => {
  // Evaluation-run lock (same key as the backend), then the request row.
  const lock = DECIDE_BODY.indexOf("pg_advisory_xact_lock(hashtextextended('course_equivalency:'")
  const row = DECIDE_BODY.indexOf('for update;')
  assert.ok(lock > 0 && row > lock)
  assert.match(DECIDE_BODY, /if v_request\."Current_Status" <> 'In Progress' then\s+raise exception using errcode = '55000', message = 'already_decided';/)
  assert.match(SQL_INSTALL, /CREATE UNIQUE INDEX decision_one_per_course_equivalency_request\s+ON public\."Decision" USING btree \("Request_ID"\)\s+WHERE \(\("Decision_Type"\)::text = ANY \(\(ARRAY\['Course Equivalency Approved'::character varying,\s+'Course Equivalency Rejected'::character varying\]\)::text\[\]\)\);/)
  // The Decision row, then the status update (which fires history, notification, audit).
  const decisionInsert = DECIDE_BODY.indexOf('insert into public."Decision"')
  const statusUpdate = DECIDE_BODY.indexOf('set "Current_Status" = v_status')
  assert.ok(decisionInsert > row && statusUpdate > decisionInsert)
  assert.match(DECIDE_BODY, /v_status := 'Completed';\s+v_type := 'Course Equivalency Approved';/)
  assert.match(DECIDE_BODY, /v_status := 'Rejected';\s+v_type := 'Course Equivalency Rejected';/)
  assert.match(SQL_INSTALL, /^BEGIN;$/m)
  assert.match(SQL_INSTALL, /^COMMIT;$/m)
})

test('decision function: a completed, current evaluation is required', () => {
  assert.match(DECIDE_BODY, /e\.run_status = 'running'\s+and e\.started_at >= now\(\) - interval '15 minutes'\) then\s+raise exception using errcode = '55000', message = 'evaluation_running';/)
  assert.match(DECIDE_BODY, /message = 'evaluation_failed'/)
  assert.match(DECIDE_BODY, /message = 'evaluation_missing'/)
  assert.match(DECIDE_BODY, /or v_used_old is distinct from v_cur_old\s+or v_used_new is distinct from v_cur_new then\s+raise exception using errcode = '55000', message = 'evaluation_outdated';/)
  // Exactly two references: one old, one new, no duplicates or extras.
  assert.match(DECIDE_BODY, /count\(\*\),\s+count\(\*\) filter \(where ref ->> 'side' = 'old'\),\s+count\(\*\) filter \(where ref ->> 'side' = 'new'\),/)
  assert.match(DECIDE_BODY, /or v_ref_count <> 2 or v_ref_old <> 1 or v_ref_new <> 1/)
  // The same evaluation-run lock key as the backend (repository.lock_request).
  const REPO = source('../../backend/app/agents/course_equivalency/repository.py')
  assert.match(REPO, /LOCK_PREFIX = "course_equivalency"/)
  assert.match(REPO, /pg_advisory_xact_lock\(hashtextextended\(:key, 0\)\)"\),\s+\{"key": f"\{LOCK_PREFIX\}:\{request_id\}"\}/)
  assert.match(DECIDE_BODY, /pg_advisory_xact_lock\(hashtextextended\('course_equivalency:' \|\| coalesce\(p_request_id, ''\), 0\)\)/)
  assert.match(DECIDE_BODY, /if p_evaluation_id is distinct from v_eval\.id then\s+raise exception using errcode = '55000', message = 'evaluation_changed';/)
  assert.match(DECIDE_BODY, /if v_override and coalesce\(p_confirm_override, false\) is not true then\s+raise exception using errcode = '22023', message = 'override_confirmation_required';/)
})

test('academic records are out of scope: no Takes, Student, CGPA, hours, program or TR', () => {
  for (const body of [DECIDE_BODY, VIEW_BODY]) {
    assert.doesNotMatch(body, /"Takes"|"Student"|"Section"|"CGPA"|"Completed_Hours"|"Program_ID"/)
    assert.doesNotMatch(body, /'TR'/)
  }
  for (const sql of [SQL_INSTALL, SQL_GUARD, SQL_ROLLBACK]) {
    assert.doesNotMatch(sql, /(insert into|update|delete from|alter table|truncate)\s+public\."(Takes|Student|Section|Course_Equivalency)"/i)
  }
  assert.match(DECIDE_BODY, /'academic_record_updated', false/)
})

test('status guard: restrictive, Course Equivalency only, after the function exists', () => {
  assert.match(SQL_GUARD, /create policy course_equivalency_status_by_function_only\s+on public\."Request"\s+as restrictive\s+for update\s+to authenticated\s+using \(\("Request_Type"\)::text is distinct from 'Course Equivalency'\)\s+with check \(\("Request_Type"\)::text is distinct from 'Course Equivalency'\);/)
  assert.match(SQL_GUARD, /decide_course_equivalency_request does not exist: run 01_install\.sql first/)
  assert.match(SQL_GUARD, /Senior web app/)
  assert.match(SQL_GUARD_VERIFY, /other status guard still present/)
  assert.match(SQL_GUARD_ROLLBACK, /drop policy if exists course_equivalency_status_by_function_only on public\."Request";/)
})

test('verify, rollback, preflight and rehearsal scripts are safe', () => {
  // Verify scripts and the preflight are read-only.
  for (const sql of [SQL_VERIFY, SQL_GUARD_VERIFY, SQL_PREFLIGHT]) {
    assert.doesNotMatch(statements(sql), /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE)\b/i)
  }
  // Rollback refuses once real decisions exist and needs the guard removed first.
  assert.match(SQL_ROLLBACK, /Course Equivalency Decision rows exist; nothing was changed\./)
  assert.match(SQL_ROLLBACK, /run 06_status_guard_rollback\.sql first/)
  assert.doesNotMatch(statements(SQL_ROLLBACK), /CASCADE/)
  // The rehearsal can never commit: every change is inside one DO block whose only exits
  // are exceptions (no RETURN in it), plus BEGIN ... ROLLBACK, and there is no COMMIT.
  const block = between(SQL_REHEARSAL, 'DO $rehearsal$', '$rehearsal$;\n')
  assert.doesNotMatch(block, /^\s*RETURN\b/m)
  const beforeBlock = SQL_REHEARSAL.slice(0, SQL_REHEARSAL.indexOf('DO $rehearsal$'))
  // Outside the block only helper functions are defined (their bodies run only when the block calls them).
  const outside = statements(beforeBlock.replace(/\$f\$[\s\S]*?\$f\$/g, ''))
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
  assert.equal(outside[0], 'BEGIN')
  assert.ok(outside.length > 5)
  for (const part of outside.slice(1)) assert.match(part, /^CREATE OR REPLACE FUNCTION pg_temp\.[a-z_]+\(/)
  // Scenario blocks swallow only their own 'scenario_undo'; anything else is re-raised.
  assert.equal(
    (block.match(/EXCEPTION WHEN others THEN\s+IF sqlerrm <> 'scenario_undo' THEN RAISE; END IF;/g) ?? []).length,
    (block.match(/RAISE EXCEPTION 'scenario_undo';/g) ?? []).length,
  )
  assert.equal((SQL_REHEARSAL.match(/CREATE FUNCTION pg_temp\./g) ?? []).length, 0)   // CREATE OR REPLACE: re-runnable
  assert.match(SQL_REHEARSAL, /RAISE EXCEPTION 'REHEARSAL PASSED \(status guard installed: %\)\. Everything above was rolled back\.', v_guard;\s+END\s+\$rehearsal\$;\s+ROLLBACK;\s*$/)
  assert.doesNotMatch(SQL_REHEARSAL, /^\s*COMMIT;/m)
  // ...and checks the transcript, the student record, duplicates, identities and the guard.
  for (const label of [
    'Takes unchanged after approval', 'Student (CGPA, Completed_Hours, Program_ID, ...) unchanged after approval',
    'Takes unchanged after a rejection', 'second approval', 'unique index stops a second decision row',
    'unknown account is refused', 'the student cannot decide', 'staff cannot insert Decision rows directly',
    'status guard: a direct staff UPDATE changes nothing', 'approve against REJECT without confirmation',
    'override approval stored as one approval Decision row', 'an evaluation is running', 'only a failed evaluation',
    'outdated: old syllabus replaced', 'no evaluation at all', 'another account sees nothing',
    'failed latest re-evaluation blocks an older completed one', 'running re-evaluation blocks an older completed one',
    'interrupted latest re-evaluation blocks an older completed one', 'decided on an older evaluation',
    'Course Substitution function still refuses a CE request',
  ]) {
    assert.ok(SQL_REHEARSAL.includes(`'${label}'`), label)
  }
})

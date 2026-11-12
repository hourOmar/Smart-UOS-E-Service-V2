// The Course Substitution staff review page: the evaluation display rules
// (five checks, overall result, Summer limitation, suggested explanations,
// saved-state summary) and static guarantees: opening the page never runs the
// agent, runs and decisions come only from explicit staff clicks, and nothing
// handles the token. Run: npm test (no browser, backend or database).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  ADVISORY_NOTE,
  SUMMER_LIMITATION_MESSAGE,
  canStartFirstEvaluation,
  canStartReevaluation,
  checkRows,
  courseSubstitutionEvaluationPath,
  courseSubstitutionEvaluationsPath,
  evaluationRequestBody,
  rejectionSuggestions,
  savedEvaluationStatus,
  summerLimitation,
  termLabel,
  type CourseSubstitutionEvaluationState,
  type CourseSubstitutionRejection,
  type CourseSubstitutionRun,
} from '../src/utils/courseSubstitutionEvaluation.ts'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const SERVICE = source('../src/services/courseSubstitutionReview.ts')
const HOOK = source('../src/hooks/useCourseSubstitutionEvaluation.ts')
const PAGE = source('../src/pages/AdminCourseSubstitutionReview.tsx')
const EVALUATION_PANEL = source('../src/components/courseSubstitutionReview/EvaluationPanel.tsx')
const DECISION_PANEL = source('../src/components/courseSubstitutionReview/DecisionPanel.tsx')
const APP = source('../src/App.tsx')

const CHECKS = [
  { condition: 'Original course unavailable before graduation', status: 'PASS', evidence: 'Not offered before 202602.' },
  { condition: 'Proposed course is at the same level or higher', status: 'PASS', evidence: 'Level 300 vs 300.' },
  { condition: 'Original course is a core course', status: 'PASS', evidence: 'Core in the study plan.' },
  { condition: 'Proposed course is offered in the current semester', status: 'FAIL', evidence: 'Not offered in Fall.' },
  { condition: 'Proposed course has not been completed previously', status: 'REQUIRES_REVIEW', evidence: 'Grade unclear.' },
]

function state(overrides: Partial<CourseSubstitutionEvaluationState> = {}): CourseSubstitutionEvaluationState {
  return {
    request_id: 'STUD_CSUB_900001', request_status: 'In Progress', details_missing: false,
    details_missing_message: null, current: null, latest_attempt: null, in_progress: false, run_count: 0,
    auto_run_eligible: true, can_rerun: true, ...overrides,
  }
}

function run(overrides: Partial<CourseSubstitutionRun> = {}): CourseSubstitutionRun {
  return {
    id: 1, run_status: 'completed', trigger: 'first_open', started_at: '2026-11-07T10:00:00+00:00',
    finished_at: '2026-11-07T10:00:20+00:00', overall_result: 'NOT_ELIGIBLE', current_term: 202601,
    current_semester: 'Fall', checks: CHECKS, rejection: null, study_plan_model: 'gemini-3.6-flash',
    rejection_model: null, gemini_error: null, agent_version: '1.0.0', failure_kind: null, error_message: null,
    ...overrides,
  }
}

function rejection(overrides: Partial<CourseSubstitutionRejection> = {}): CourseSubstitutionRejection {
  return {
    status: 'gemini',
    deterministic_keywords: [{ keyword: 'proposed_course_not_offered', label: 'Proposed course not offered in the current semester', policy_basis: '' }],
    judgment_keywords: ['course_offering_information_uncertain', 'made_up_keyword'],
    // Stored out of order on purpose: the page shows formal, concise, supportive.
    suggested_reasons: [
      { tone: 'supportive', text: ' We understand… ' },
      { tone: 'formal', text: 'The request is declined.' },
      { tone: 'concise', text: 'Not offered this semester.' },
    ],
    conflict_note: '',
    ...overrides,
  }
}

// -- paths and run guards ------------------------------------------------------------

test('the backend paths are the staff routes, with the ID encoded', () => {
  assert.equal(courseSubstitutionEvaluationPath('STUD_CSUB_900001'), '/api/staff/course-substitution/STUD_CSUB_900001/evaluation')
  assert.equal(courseSubstitutionEvaluationsPath('a/b c'), '/api/staff/course-substitution/a%2Fb%20c/evaluations')
  assert.equal(evaluationRequestBody(false), '{"rerun":false}')
  assert.equal(evaluationRequestBody(true), '{"rerun":true}')
})

test('a first run and a re-run are allowed only when the saved state allows them', () => {
  assert.equal(canStartFirstEvaluation(state(), false), true)
  assert.equal(canStartFirstEvaluation(state(), true), false)
  assert.equal(canStartFirstEvaluation(null, false), false)
  assert.equal(canStartFirstEvaluation(state({ auto_run_eligible: false }), false), false)
  assert.equal(canStartFirstEvaluation(state({ details_missing: true }), false), false)
  assert.equal(canStartFirstEvaluation(state({ in_progress: true }), false), false)
  assert.equal(canStartReevaluation(state(), false), true)
  assert.equal(canStartReevaluation(state({ can_rerun: false }), false), false)
  assert.equal(canStartReevaluation(state({ in_progress: true }), false), false)
  assert.equal(canStartReevaluation(state({ details_missing: true }), false), false)
})

// -- the five checks ------------------------------------------------------------------

test('the five checks keep their stored order, text and PASS / FAIL / REQUIRES_REVIEW status', () => {
  const rows = checkRows(run())
  assert.ok(rows)
  assert.equal(rows.length, 5)
  assert.deepEqual(rows.map((r) => r.condition), CHECKS.map((c) => c.condition))
  assert.deepEqual(rows.map((r) => r.status), ['PASS', 'PASS', 'PASS', 'FAIL', 'REQUIRES_REVIEW'])
  assert.deepEqual(rows.map((r) => r.tone), ['pass', 'pass', 'pass', 'fail', 'review'])
  assert.equal(rows[4].label, 'REQUIRES REVIEW')
  assert.equal(rows[3].evidence, 'Not offered in Fall.')
})

test('an unknown status is never shown as a pass, and missing text is labelled', () => {
  const rows = checkRows(run({ checks: [{ condition: '', status: 'MAYBE', evidence: '' }] as never }))
  assert.ok(rows)
  assert.equal(rows[0].status, 'REQUIRES_REVIEW')
  assert.equal(rows[0].condition, 'Check 1')
  assert.equal(rows[0].evidence, 'No evidence recorded.')
  assert.equal(checkRows(run({ checks: null })), null)
  assert.equal(checkRows(run({ checks: [] })), null)
  assert.equal(checkRows(null), null)
})

// -- Summer limitation ---------------------------------------------------------------

test('the Summer limitation is shown only for a completed run without a term', () => {
  assert.equal(summerLimitation(run()), null)
  assert.equal(summerLimitation(run({ current_term: null, current_semester: null, overall_result: 'MANUAL_REVIEW' })),
    SUMMER_LIMITATION_MESSAGE)
  assert.equal(summerLimitation(run({ run_status: 'failed', current_term: null })), null)
  assert.equal(summerLimitation(null), null)
  assert.match(SUMMER_LIMITATION_MESSAGE, /June and July have no supported Summer term/)
})

test('the term checked is shown with its semester', () => {
  assert.equal(termLabel(run()), 'Fall 2026 (202601)')
  assert.equal(termLabel(run({ current_term: 202602, current_semester: 'Spring' })), 'Spring 2026 (202602)')
  assert.equal(termLabel(run({ current_term: null, current_semester: null })), null)
})

// -- rejection explanations ------------------------------------------------------------

test('suggestions only for NOT_ELIGIBLE, in the order formal, concise, supportive', () => {
  assert.equal(rejectionSuggestions(run({ overall_result: 'ELIGIBLE', rejection: rejection() })), null)
  assert.equal(rejectionSuggestions(run({ overall_result: 'MANUAL_REVIEW', rejection: rejection() })), null)
  const s = rejectionSuggestions(run({ rejection: rejection() }))
  assert.ok(s)
  assert.deepEqual(s.reasons.map((r) => r.label), ['Formal', 'Concise', 'Supportive'])
  assert.equal(s.reasons[2].text, 'We understand…')
  assert.equal(s.message, null)
  assert.deepEqual(s.policyReasons, ['Proposed course not offered in the current semester'])
  // Known judgment keywords by label only; unknown ids are dropped.
  assert.deepEqual(s.assessedReasons, ['Course offering information is uncertain'])
  assert.equal(s.conflictNote, null)
})

test('fallback and missing suggestions are explained', () => {
  const fallback = rejectionSuggestions(run({ rejection: rejection({ status: 'fallback', conflict_note: ' Check 5 is unclear. ' }) }))
  assert.match(fallback?.message ?? '', /built from the verified checks only/)
  assert.equal(fallback?.conflictNote, 'Check 5 is unclear.')
  const none = rejectionSuggestions(run({ rejection: null }))
  assert.deepEqual(none?.reasons, [])
  assert.match(none?.message ?? '', /Write the explanation yourself/)
  const empty = rejectionSuggestions(run({ rejection: rejection({ suggested_reasons: [{ tone: 'formal', text: ' ' }] }) }))
  assert.match(empty?.message ?? '', /Write the explanation yourself/)
})

// -- saved evaluation summary -------------------------------------------------------------

test('never evaluated: says so, and that opening the page does not start one', () => {
  const saved = savedEvaluationStatus(state())
  assert.equal(saved.tone, 'none')
  assert.match(saved.detail, /does not start one/)
  assert.match(savedEvaluationStatus(state({ auto_run_eligible: false })).detail, /none can start/)
})

test('details missing comes first and shows the backend message', () => {
  const saved = savedEvaluationStatus(state({ details_missing: true, details_missing_message: 'No details.', in_progress: true }))
  assert.equal(saved.tone, 'missing')
  assert.equal(saved.detail, 'No details.')
})

test('running, completed, failed and interrupted states', () => {
  assert.equal(savedEvaluationStatus(state({ in_progress: true })).tone, 'running')
  const done = savedEvaluationStatus(state({ current: run({ overall_result: 'ELIGIBLE' }) }))
  assert.equal(done.label, 'Evaluated · Eligible')
  assert.match(done.detail, /advisory/)
  const failed = savedEvaluationStatus(state({
    latest_attempt: run({ run_status: 'failed', overall_result: null, failure_kind: 'technical', error_message: 'Try again later.' }),
  }))
  assert.equal(failed.label, 'Last attempt failed')
  assert.equal(failed.detail, 'Try again later.')
  const interrupted = savedEvaluationStatus(state({ latest_attempt: run({ run_status: 'interrupted', overall_result: null }) }))
  assert.equal(interrupted.label, 'Last attempt interrupted')
})

test('a failed re-run keeps the last good result', () => {
  const saved = savedEvaluationStatus(state({
    current: run({ id: 1, overall_result: 'MANUAL_REVIEW' }),
    latest_attempt: run({ id: 2, run_status: 'failed', overall_result: null }),
  }))
  assert.equal(saved.tone, 'evaluated')
  assert.equal(saved.label, 'Evaluated · Manual review')
  assert.match(saved.detail, /last successful evaluation/)
  assert.match(EVALUATION_PANEL, /The result below is the last successful evaluation\s+and has not been replaced\./)
  // The hook keeps data on a failed action and reports the problem beside it.
  assert.match(HOOK, /update\(\{ running: false, notice: messageOf\(error\) \}\)/)
  assert.match(HOOK, /prev\.data \? \{ notice: messageOf\(error\) \}/)
})

// -- service guarantees ---------------------------------------------------------------------

test('the saved-state read is a GET that never runs the agent', () => {
  const start = SERVICE.indexOf('export async function fetchCourseSubstitutionEvaluation')
  const end = SERVICE.indexOf('\n}\n', start)
  assert.ok(start >= 0 && end > start)
  const read = SERVICE.slice(start, end)
  assert.match(read, /courseSubstitutionEvaluationPath\(requestId\)/)
  assert.match(read, /method: 'GET'/)
  assert.doesNotMatch(read, /POST|EvaluationsPath|rerun/)
})

test('the service goes through callBackend and never handles the token itself', () => {
  assert.match(SERVICE, /callBackend</)
  for (const forbidden of [/\bfetch\(/, /access_token/, /getSession/, /console\./, /localStorage/, /sessionStorage/,
    /setInterval/, /setTimeout/, /\.storage\./, /service_role/i]) {
    assert.doesNotMatch(SERVICE, forbidden)
  }
})

// -- review page guarantees -------------------------------------------------------------------

const UI = { PAGE, EVALUATION_PANEL, DECISION_PANEL }

test('the page and its panels never touch the token, Supabase, storage or timers directly', () => {
  for (const [name, text] of Object.entries(UI)) {
    for (const forbidden of [/\bsupabase\b/, /\bfetch\(/, /access_token/, /getSession/, /console\./, /localStorage/,
      /sessionStorage/, /setInterval/, /setTimeout/, /callBackend/, /requestCourseSubstitutionEvaluation/, /service_role/i]) {
      assert.doesNotMatch(text, forbidden, `${name} must not match ${forbidden}`)
    }
  }
})

test('opening the page never runs the agent: runs come only from Run Evaluation / Re-evaluate clicks', () => {
  assert.doesNotMatch(PAGE, /useEffect/)
  assert.doesNotMatch(EVALUATION_PANEL, /useEffect/)
  // The hook's only effect that calls the backend loads the saved state; it
  // never posts. Runs are started only by run(), which is guarded.
  assert.doesNotMatch(HOOK, /autoRequested|\.auto_run_eligible/)
  assert.equal(HOOK.match(/requestCourseSubstitutionEvaluation\(/g)?.length, 1)
  assert.match(HOOK, /void load\(0\)\n {4}return \(\) =>/)
  assert.match(HOOK, /canStartReevaluation\(current\.data, current\.running\)/)
  assert.match(HOOK, /canStartFirstEvaluation\(current\.data, current\.running\)/)
  // Every call of onRun in the panel is a click handler.
  const calls = EVALUATION_PANEL.match(/onRun\(/g)?.length ?? 0
  const clicks = EVALUATION_PANEL.match(/on(Click|Retry)=\{\(\) => onRun\((true|false)\)\}/g)?.length ?? 0
  assert.ok(calls > 0 && calls === clicks, `${calls} onRun calls, ${clicks} in click handlers`)
  assert.match(EVALUATION_PANEL, /\{firstAllowed && \(\s+<button type="button" className="pcr-primary" onClick=\{\(\) => onRun\(false\)\}>\s+Run Evaluation/)
  assert.match(EVALUATION_PANEL, /disabled=\{!rerunAllowed\}/)
  assert.match(PAGE, /onRun=\{evaluation\.run\}/)
})

test('the result is labelled advisory, with the Summer note, checks and failures shown apart', () => {
  assert.equal(ADVISORY_NOTE, 'Advisory only — the final decision belongs to the administrator.')
  assert.match(EVALUATION_PANEL, /\{ADVISORY_NOTE\}/)
  assert.match(EVALUATION_PANEL, /Course Substitution Eligibility Agent · advisory/)
  assert.match(EVALUATION_PANEL, /\{summer && \(/)
  assert.match(EVALUATION_PANEL, /checkRows\(run\)/)
  assert.match(EVALUATION_PANEL, /No result was recorded/)
  assert.match(EVALUATION_PANEL, /Opening this page never starts an evaluation\./)
})

test('decisions are saved only after confirmation, through the decision service', () => {
  assert.equal(DECISION_PANEL.match(/decideCourseSubstitutionRequest\(/g)?.length, 1)
  assert.match(DECISION_PANEL, /const save = async \(\) => \{\s+if \(!choice \|\| savingRef\.current\) return/)
  assert.match(DECISION_PANEL, /onClick=\{\(\) => void save\(\)\}/)
  assert.match(DECISION_PANEL, /if \(!choice \|\| explanationError\(explanation, true\) !== null\) return/)
  assert.match(DECISION_PANEL, /\{finalized \? \(\s+<RecordedDecision record=\{record\} \/>\s+\) : !request\.details \? \(/)
  assert.match(SERVICE, /supabase\.rpc\('decide_course_substitution_request', \{\s+p_request_id: requestId,\s+p_decision: choice,\s+p_explanation: explanation\.trim\(\),\s+\}\)/)
})

test('"Use this reason" only fills the editable explanation; staff still choose the outcome', () => {
  assert.match(EVALUATION_PANEL, /onClick=\{\(\) => onUseReason\(reason\.text\)\}/)
  const apply = PAGE.slice(PAGE.indexOf('const applyReason'), PAGE.indexOf('}, [])', PAGE.indexOf('const applyReason')))
  assert.match(apply, /setExplanation\(text\)/)
  assert.doesNotMatch(apply, /setChoice|decide|save/)
  assert.match(PAGE, /onUseReason=\{decidable && decisionStep === 'form' \? applyReason : null\}/)
})

test('"Approved" on the review page comes only from a recorded approval decision', () => {
  assert.match(PAGE, /return record\.decision\?\.choice === 'approve'/)
  assert.equal(PAGE.match(/approvalRecorded=\{approvalRecorded\((record|found)\)\}/g)?.length, 2)
})

test('the review link and the staff-only route exist, and every other route is kept', () => {
  const REVIEW_ACTION = source('../src/components/admin/ReviewAction.tsx')
  assert.match(REVIEW_ACTION, /'Course Substitution': courseSubstitutionReviewPath/)
  assert.match(PAGE, /: \{ to: adminTypePath\('course-substitution'\), label: 'Course Substitution requests' \}/)
  assert.match(APP, /path="\/admin\/requests\/course-substitution\/:requestId"\s+element=\{\s+<ProtectedRoute requiredRole="admin">\s+<AdminCourseSubstitutionReview \/>/)
  for (const route of ['/admin', '/admin/requests/raise-capacity/:requestId', '/admin/requests/program-change/:requestId',
    '/admin/requests/incomplete-exam/:requestId', '/admin/requests/:typeId']) {
    assert.ok(APP.includes(`path="${route}"`), `route ${route} is kept`)
  }
})

// The Incomplete Exam staff review page: the saved-evaluation summary, the GET
// path, and static guarantees: opening the page never runs the agents, runs
// and decisions come only from explicit staff clicks, proof documents are
// opened only through the private download, and nothing handles the token.
// Run: npm test (no browser, backend or database).
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  RECOMMENDATION_LABELS,
  incompleteExamEvaluationPath,
  savedEvaluationStatus,
  yesNo,
  type IncompleteExamEvaluationState,
  type IncompleteExamRun,
} from '../src/utils/incompleteExamEvaluation.ts'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const SERVICE = source('../src/services/incompleteExamReview.ts')
const PAGE = source('../src/pages/AdminIncompleteExamReview.tsx')
const UTILS = source('../src/utils/incompleteExamEvaluation.ts')
const APP = source('../src/App.tsx')

function state(overrides: Partial<IncompleteExamEvaluationState> = {}): IncompleteExamEvaluationState {
  return {
    request_id: 'STUD_INCRQ_INC2_900052', request_status: 'In Progress', details_missing: false,
    details_missing_message: null, current: null, latest_attempt: null, in_progress: false, run_count: 0,
    auto_run_eligible: true, can_rerun: true, ...overrides,
  }
}

function run(overrides: Partial<IncompleteExamRun> = {}): IncompleteExamRun {
  return {
    id: 1, run_status: 'completed', trigger: 'first_open', started_at: '2026-11-07T10:00:00+00:00',
    finished_at: '2026-11-07T10:00:20+00:00', recommendation: 'MANUAL_REVIEW', recommendation_conflict: false,
    assessment_model: 'gemini-3.6-flash', rejection_model: null, agent_version: '1.2.0', failure_kind: null,
    error_message: null, ...overrides,
  }
}

// -- the GET path ------------------------------------------------------------------

test('the evaluation path is the staff GET route, with the ID encoded', () => {
  assert.equal(incompleteExamEvaluationPath('STUD_INCRQ_INC2_900052'),
    '/api/staff/incomplete-exam/STUD_INCRQ_INC2_900052/evaluation')
  assert.equal(incompleteExamEvaluationPath('a/b c'), '/api/staff/incomplete-exam/a%2Fb%20c/evaluation')
})

// -- saved evaluation summary -----------------------------------------------------------

test('never evaluated and eligible: says so, and that this page does not start one', () => {
  const saved = savedEvaluationStatus(state())
  assert.equal(saved.tone, 'none')
  assert.equal(saved.label, 'Not evaluated yet')
  assert.match(saved.detail, /does not start one/)
})

test('not eligible (finalized) and never evaluated', () => {
  const saved = savedEvaluationStatus(state({ request_status: 'Completed', auto_run_eligible: false, can_rerun: false }))
  assert.match(saved.detail, /none can start/)
})

test('details missing comes first and shows the backend message', () => {
  const saved = savedEvaluationStatus(state({ details_missing: true, details_missing_message: 'No details.',
    auto_run_eligible: false, can_rerun: false }))
  assert.deepEqual(saved, { tone: 'missing', label: 'Details missing', detail: 'No details.' })
})

test('a running evaluation', () => {
  assert.equal(savedEvaluationStatus(state({ in_progress: true, run_count: 1 })).tone, 'running')
})

test('a completed evaluation shows the advisory recommendation', () => {
  for (const [value, label] of Object.entries(RECOMMENDATION_LABELS)) {
    const saved = savedEvaluationStatus(state({ current: run({ recommendation: value as IncompleteExamRun['recommendation'] }),
      run_count: 1, auto_run_eligible: false }))
    assert.equal(saved.label, `Evaluated · ${label}`)
    assert.match(saved.detail, /decision stays with staff/)
  }
})

test('a failed later attempt keeps the last successful result', () => {
  const saved = savedEvaluationStatus(state({ current: run(), latest_attempt: run({ id: 2, run_status: 'failed',
    recommendation: null, failure_kind: 'technical', error_message: 'Gemini was unavailable.' }), run_count: 2 }))
  assert.equal(saved.tone, 'evaluated')
  assert.match(saved.detail, /later attempt failed/)
})

test('only a failed attempt: shows its safe message, never a recommendation', () => {
  const saved = savedEvaluationStatus(state({ latest_attempt: run({ run_status: 'failed', recommendation: null,
    failure_kind: 'technical', error_message: 'The AI service (Gemini) was unavailable.' }), run_count: 1,
  auto_run_eligible: false }))
  assert.deepEqual(saved, { tone: 'failed', label: 'Last attempt failed', detail: 'The AI service (Gemini) was unavailable.' })
  const interrupted = savedEvaluationStatus(state({ latest_attempt: run({ run_status: 'interrupted', recommendation: null,
    failure_kind: 'interrupted', error_message: null }), run_count: 1, auto_run_eligible: false }))
  assert.equal(interrupted.label, 'Last attempt interrupted')
})

test('yes / no labels', () => {
  assert.equal(yesNo(true), 'Yes')
  assert.equal(yesNo(false), 'No')
})

// -- service guarantees ------------------------------------------------------------------

test('the saved-state read is a GET that never runs the agents', () => {
  const start = SERVICE.indexOf('export async function fetchIncompleteExamEvaluation')
  // The function body only (up to its closing brace), not the next function's doc comment.
  const end = SERVICE.indexOf('\n}\n', start)
  assert.ok(start >= 0 && end > start)
  const read = SERVICE.slice(start, end)
  assert.match(read, /incompleteExamEvaluationPath\(requestId\)/)
  assert.match(read, /method: 'GET'/)
  assert.doesNotMatch(read, /POST|evaluationsPath|rerun/)
})

test('the service never handles the token, logs, stores or makes public links', () => {
  for (const forbidden of [/\bfetch\(/, /access_token/, /getSession/, /console\./, /localStorage/, /sessionStorage/,
    /setInterval/, /setTimeout/, /createSignedUrl/, /getPublicUrl/, /\.upload\(/, /\.remove\(/, /service_role/i]) {
    assert.doesNotMatch(SERVICE, forbidden)
  }
})

// -- review page guarantees -------------------------------------------------------------------

const EVALUATION_PANEL = source('../src/components/incompleteExamReview/EvaluationPanel.tsx')
const DECISION_PANEL = source('../src/components/incompleteExamReview/DecisionPanel.tsx')
const PROOFS = source('../src/components/incompleteExamReview/ProofDocuments.tsx')
const UI = { PAGE, EVALUATION_PANEL, DECISION_PANEL, PROOFS }

test('the page and its panels never touch the token, Supabase, storage or timers directly', () => {
  for (const [name, text] of Object.entries(UI)) {
    for (const forbidden of [/\bsupabase\b/, /\bfetch\(/, /access_token/, /getSession/, /console\./, /localStorage/,
      /sessionStorage/, /setInterval/, /setTimeout/, /createSignedUrl/, /getPublicUrl/, /callBackend/,
      /requestIncompleteExamEvaluation/, /service_role/i]) {
      assert.doesNotMatch(text, forbidden, `${name} must not match ${forbidden}`)
    }
  }
})

test('opening the page never runs the agents: runs come only from Run Evaluation / Re-evaluate clicks', () => {
  // No effect in the page or the evaluation panel; the only effect in the
  // proof panel releases local URLs on unmount.
  assert.doesNotMatch(PAGE, /useEffect/)
  assert.doesNotMatch(EVALUATION_PANEL, /useEffect/)
  assert.equal(PROOFS.match(/useEffect\(/g)?.length, 1)
  assert.match(PROOFS, /for \(const revoke of list\.splice\(0\)\) revoke\(\)/)
  // Every call of onRun is a click handler (onRetry is only the failed
  // attempt's Re-evaluate button).
  const calls = EVALUATION_PANEL.match(/onRun\(/g)?.length ?? 0
  const clicks = EVALUATION_PANEL.match(/on(Click|Retry)=\{\(\) => onRun\((true|false)\)\}/g)?.length ?? 0
  assert.ok(calls > 0 && calls === clicks, `${calls} onRun calls, ${clicks} in click handlers`)
  assert.match(EVALUATION_PANEL, /<button type="button" className="pcr-primary" onClick=\{onRetry\}>\s+Re-evaluate/)
  assert.match(EVALUATION_PANEL, /\{firstAllowed && \(\s+<button type="button" className="pcr-primary" onClick=\{\(\) => onRun\(false\)\}>\s+Run Evaluation/)
  assert.match(EVALUATION_PANEL, /disabled=\{!rerunAllowed\}/)
  assert.match(EVALUATION_PANEL, /'Re-evaluate'/)
  assert.match(PAGE, /onRun=\{evaluation\.run\}/)
})

test('technical failures are shown apart from recommendations, and conflicts are flagged', () => {
  assert.match(EVALUATION_PANEL, /Technical failure: the evaluation couldn’t be completed/)
  assert.match(EVALUATION_PANEL, /No recommendation was recorded/)
  assert.match(EVALUATION_PANEL, /Technical failure: the latest re-evaluation/)
  assert.match(EVALUATION_PANEL, /\{run\.recommendation_conflict && \(\s+<p className="pcr-conflict" role="alert">/)
  assert.match(EVALUATION_PANEL, /Advisory only — the final decision belongs to the administrator\./)
})

test('proof documents open only on a click, through the private download', () => {
  assert.match(PROOFS, /await openProofDocument\(requestId, path\)/)
  assert.equal(PROOFS.match(/openProofDocument\(/g)?.length, 1)
  assert.match(PROOFS, /onClick=\{\(\) => void handle\(path, 'open'\)\}/)
  assert.match(PROOFS, /onClick=\{\(\) => void handle\(path, 'download'\)\}/)
  assert.match(PROOFS, /tab\.opener = null/)
  assert.match(PROOFS, /revokers\.current\.push\(proof\.revoke\)/)
})

test('decisions are saved only after confirmation, through the decision service', () => {
  assert.equal(DECISION_PANEL.match(/decideIncompleteExamRequest\(/g)?.length, 1)
  assert.match(DECISION_PANEL, /const save = async \(\) => \{\s+if \(!choice \|\| savingRef\.current\) return/)
  assert.match(DECISION_PANEL, /onClick=\{\(\) => void save\(\)\}/)
  assert.match(DECISION_PANEL, /if \(!choice \|\| explanationError\(explanation, true\) !== null\) return/)
  // Missing details or a finalized request: no form at all.
  assert.match(DECISION_PANEL, /\{finalized \? \(\s+<RecordedDecision record=\{record\} \/>\s+\) : !request\.details \? \(/)
})

test('"Use this reason" only fills the editable explanation; staff still choose the outcome', () => {
  assert.match(EVALUATION_PANEL, /onClick=\{\(\) => onUseReason\(reason\.text\)\}/)
  const apply = PAGE.slice(PAGE.indexOf('const applyReason'), PAGE.indexOf('}, [])', PAGE.indexOf('const applyReason')))
  assert.match(apply, /setExplanation\(text\)/)
  assert.doesNotMatch(apply, /setChoice|decide|save/)
  assert.match(PAGE, /onUseReason=\{decidable && decisionStep === 'form' \? applyReason : null\}/)
  assert.match(PAGE, /const decidable = Boolean\(found && found\.request\.status === 'In Progress' && found\.request\.details\)/)
  assert.match(DECISION_PANEL, /value=\{explanation\}/)
})

test('the review link is enabled for Incomplete Exam with the back-navigation origin', () => {
  const REVIEW_ACTION = source('../src/components/admin/ReviewAction.tsx')
  assert.match(REVIEW_ACTION, /'Incomplete Exam': incompleteExamReviewPath/)
  assert.match(REVIEW_ACTION, /state=\{\{ from: origin \}\}/)
  assert.match(PAGE, /origin === 'dashboard'\s+\? \{ to: ADMIN_HOME_PATH, label: 'Admin home' \}\s+: \{ to: adminTypePath\('incomplete-exam'\), label: 'Incomplete Exam requests' \}/)
})

test('students see the final Incomplete Exam decision and explanation', () => {
  const STUDENT_PAGE = source('../src/pages/StudentRequestDetails.tsx')
  assert.match(STUDENT_PAGE, /const showIncompleteExamDecision = request\.type === INCOMPLETE_EXAM && decided/)
  assert.match(STUDENT_PAGE, /useIncompleteExamDecision\(request\.id, showIncompleteExamDecision\)/)
  assert.match(STUDENT_PAGE, /explanation=\{incompleteExam\.decision\?\.explanation\}/)
})

test('"Approved" for an Incomplete Exam comes only from a recorded approval decision', () => {
  const STUDENT_PAGE = source('../src/pages/StudentRequestDetails.tsx')
  // Student: the decision function's approve AND a decision record (its
  // decision alone may come from the final status).
  assert.match(STUDENT_PAGE, /const approvalRecorded =\s+incompleteExam\.decision\?\.decision === 'approve' && incompleteExam\.decision\.hasDecisionRecord/)
  assert.match(STUDENT_PAGE, /approvalRecorded=\{approvalRecorded\}/)
  assert.match(STUDENT_PAGE, /decisionHeading\(request, approvalRecorded\)/)
  assert.match(STUDENT_PAGE, /statusLabel\(request\.status, request\.type, approvalRecorded\)/)
  const STUDENT_DECISION = source('../src/utils/incompleteExamStudentDecision.ts')
  assert.match(STUDENT_DECISION, /if \(!body \|\| body\.has_decision_record !== true\) return null/)
  assert.match(source('../src/services/incompleteExamStudent.ts'), /return toIncompleteExamDecisionView\(data\)/)
  // Staff: the loaded 'Incomplete Exam Approved' decision record.
  assert.match(PAGE, /return record\.decision\?\.choice === 'approve'/)
  assert.equal(PAGE.match(/approvalRecorded=\{approvalRecorded\((record|found)\)\}/g)?.length, 2)
  assert.match(PAGE, /statusLabel\(history\.status, request\.type, approvalRecorded\(record\)\)/)
  // A finalized request without a decision record keeps its stored status.
  assert.match(DECISION_PANEL, /This request is \{statusLabel\(record\.request\.status, record\.request\.type\)\}/)
})

test('the evaluation panel says document authenticity is not verified by the AI', () => {
  assert.match(EVALUATION_PANEL, /does not verify that they are authentic\. Review the supporting documents yourself before deciding\./)
  assert.match(EVALUATION_PANEL, /<p className="ier-authenticity" role="note">/)
})

test('the stated reason and an identical description are shown once', () => {
  assert.match(PAGE, /const description = distinctDescription\(d\?\.reason, request\.summary\)/)
  assert.match(PAGE, /\{description && \(/)
})

test('the temporary live-test code is gone', () => {
  assert.equal(existsSync(new URL('../src/services/incompleteExamTestRun.ts', import.meta.url)), false)
  for (const removed of [/incompleteExamTestRun/, /requestTestEvaluation/, /TEST_EVALUATION/, /isTestEvaluationRequest/,
    /canRunTestEvaluation/, /Run Test Evaluation/, /Test evaluation/, /Confirm and run/]) {
    assert.doesNotMatch(PAGE, removed)
    assert.doesNotMatch(UTILS, removed)
  }
})

test('the page is staff-only and every existing admin route is kept', () => {
  assert.match(APP, /path="\/admin\/requests\/incomplete-exam\/:requestId"\s+element=\{\s+<ProtectedRoute requiredRole="admin">\s+<AdminIncompleteExamReview \/>/)
  for (const route of ['/admin', '/admin/requests/raise-capacity/:requestId',
    '/admin/requests/program-change/:requestId', '/admin/requests/:typeId']) {
    assert.ok(APP.includes(`path="${route}"`), `route ${route} is kept`)
  }
})

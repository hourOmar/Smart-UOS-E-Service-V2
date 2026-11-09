// Incomplete Exam frontend data layer (Phase B): the review record, manual-only
// evaluation runs, proof-document safety, the staff decision and the student's
// decision view. Run: npm test (no browser, backend, Storage or database).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  CHECK_EXPLANATION_LABELS,
  canStartFirstEvaluation,
  canStartReevaluation,
  evaluationRequestBody,
  incompleteExamEvaluationsPath,
  proofOutcomes,
  JUDGMENT_REASON_LABELS,
  rejectionSuggestions,
  verifiedChecks,
  type IncompleteExamDeterministicResults,
  type IncompleteExamEvaluationState,
  type IncompleteExamRun,
} from '../src/utils/incompleteExamEvaluation.ts'
import {
  INCOMPLETE_EXAM_DECISION_MESSAGES,
  INCOMPLETE_EXAM_DECISION_TYPES,
  UNKNOWN_DECISION_MESSAGE,
  differsFromRecommendation,
  evaluationWarning,
  explanationError,
  incompleteExamDecisionErrorCode,
  incompleteExamDecisionErrorMessage,
} from '../src/utils/incompleteExamDecision.ts'
import {
  PROOF_BUCKET,
  buildIncompleteExamRecord,
  distinctDescription,
  proofContentMatches,
  proofFileName,
  proofMimeType,
  utc,
} from '../src/utils/incompleteExamRecord.ts'

import { toIncompleteExamDecisionView } from '../src/utils/incompleteExamStudentDecision.ts'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const SERVICE = source('../src/services/incompleteExamReview.ts')
const STUDENT_SERVICE = source('../src/services/incompleteExamStudent.ts')
const EVALUATION_HOOK = source('../src/hooks/useIncompleteExamEvaluation.ts')
const RID = 'STUD_INCRQ_INC2_900001'

function state(overrides: Partial<IncompleteExamEvaluationState> = {}): IncompleteExamEvaluationState {
  return {
    request_id: RID, request_status: 'In Progress', details_missing: false, details_missing_message: null,
    current: null, latest_attempt: null, in_progress: false, run_count: 0, auto_run_eligible: true, can_rerun: true,
    ...overrides,
  }
}

// -- review record -----------------------------------------------------------------------

const ROWS = {
  request: { Request_ID: RID, Request_Type: 'Incomplete Exam', Request_Date: '2026-11-04', Submission_Time: '10:30:00',
    Current_Status: 'In Progress', Description: ' Hospitalised on the exam day. ', Student_ID: 'U99000001' },
  details: { Course_ID: '1501215', Section_ID: '21', Term: 202610, Exam_Type: 'Final', Missed_Exam_Date: '2026-11-02',
    Missed_Exam_Time: '09:00:00', Proof: 'Medical report', Reason: null,
    Proof_Files: [`${RID}/medical.pdf`, '', null] },
  course: { Course_Name: 'Synthetic Course', Credit_Hours: 3 },
  student: { Student_ID: 'U99000001', Student_Name: 'Synthetic Student', Student_Email: 's@example.ac.ae', CGPA: '3.20',
    Completed_Hours: 45, Program_ID: '0402', Program_Name: null, Program: [{ College_Name: 'Computing' }] },
  decision: { Decision_ID: 9, Decision_Type: 'Incomplete Exam Rejected', Decision_Comment: 'Filed late.',
    Decision_Date: '2026-11-07 10:00:00', Staff_ID: 100001, Authorized_Staff: { Staff_Name: 'Synthetic Staff' } },
  history: { Final_Status: 'Rejected', Completion_Date: '2026-11-07 10:00:00', Staff_ID: 100001 },
}

test('the review record keeps every source, trimmed, with proof paths and UTC times', () => {
  const record = buildIncompleteExamRecord(ROWS)
  assert.equal(record.request.summary, 'Hospitalised on the exam day.')
  assert.deepEqual(record.request.details, {
    courseId: '1501215', courseName: 'Synthetic Course', creditHours: 3, sectionId: '21', term: 202610,
    examType: 'Final', missedExamDate: '2026-11-02', missedExamTime: '09:00:00', proof: 'Medical report', reason: null,
    proofFiles: [`${RID}/medical.pdf`],
  })
  assert.equal(record.student?.program, '0402')
  assert.equal(record.student?.college, 'Computing')
  assert.equal(record.student?.cgpa, 3.2)
  assert.deepEqual(record.decision, { id: 9, choice: 'reject', explanation: 'Filed late.', staffId: 100001,
    staffName: 'Synthetic Staff', date: '2026-11-07T10:00:00Z' })
  assert.deepEqual(record.history, { status: 'Rejected', staffId: 100001, date: '2026-11-07T10:00:00Z' })
})

test('missing details, student, decision and history are null, not errors', () => {
  const record = buildIncompleteExamRecord({ ...ROWS, details: null, course: null, student: null, decision: null, history: null })
  assert.equal(record.request.details, null)
  assert.equal(record.student, null)
  assert.equal(record.decision, null)
  assert.equal(record.history, null)
  assert.equal(utc('2026-11-07T10:00:00+04:00'), '2026-11-07T10:00:00+04:00')
})

test('a description identical to the stated reason is shown once; different texts are both kept', () => {
  assert.equal(distinctDescription('I was in hospital.', 'I was in hospital.'), null)
  assert.equal(distinctDescription('I was in hospital.', '  I was  in\nhospital. '), null)
  assert.equal(distinctDescription('I was in hospital.', 'Hospitalised on the exam day.'), 'Hospitalised on the exam day.')
  assert.equal(distinctDescription(null, ' Only a description. '), 'Only a description.')
  assert.equal(distinctDescription('A reason.', null), null)
  assert.equal(distinctDescription('A reason.', '   '), null)
  // Case differences are different text and are kept.
  assert.equal(distinctDescription('i was ill.', 'I was ill.'), 'I was ill.')
})

test('the decision is read only from the two Incomplete Exam decision types', () => {
  assert.deepEqual(INCOMPLETE_EXAM_DECISION_TYPES, { approve: 'Incomplete Exam Approved', reject: 'Incomplete Exam Rejected' })
  assert.match(SERVICE, /\.in\('Decision_Type', Object\.values\(INCOMPLETE_EXAM_DECISION_TYPES\)\)/)
  assert.equal(buildIncompleteExamRecord({ ...ROWS, decision: { ...ROWS.decision, Decision_Type: 'Incomplete Exam Approved' } })
    .decision?.choice, 'approve')
})

// -- evaluation: manual only ----------------------------------------------------------------

test('the POST body and path', () => {
  assert.equal(evaluationRequestBody(false), '{"rerun":false}')
  assert.equal(evaluationRequestBody(true), '{"rerun":true}')
  assert.equal(incompleteExamEvaluationsPath(RID), `/api/staff/incomplete-exam/${RID}/evaluations`)
  assert.match(SERVICE, /method: 'POST', body: evaluationRequestBody\(rerun\)/)
})

test('a first evaluation may start only when the saved state allows it', () => {
  assert.equal(canStartFirstEvaluation(state(), false), true)
  assert.equal(canStartFirstEvaluation(null, false), false)
  assert.equal(canStartFirstEvaluation(state(), true), false)
  for (const blocked of [{ auto_run_eligible: false }, { details_missing: true }, { in_progress: true }]) {
    assert.equal(canStartFirstEvaluation(state(blocked), false), false, JSON.stringify(blocked))
  }
})

test('a re-evaluation may start only when the saved state allows it', () => {
  assert.equal(canStartReevaluation(state({ run_count: 1, auto_run_eligible: false }), false), true)
  for (const blocked of [{ can_rerun: false }, { details_missing: true }, { in_progress: true }]) {
    assert.equal(canStartReevaluation(state(blocked), false), false, JSON.stringify(blocked))
  }
  assert.equal(canStartReevaluation(state(), true), false)
})

test('the evaluation hook never runs the agents on its own', () => {
  // Opening the page only loads the saved state; runs come only from run().
  assert.doesNotMatch(EVALUATION_HOOK, /autoRequested|autoEligible|auto_run_eligible === true/)
  const effects = EVALUATION_HOOK.split('useEffect(').slice(1)
  for (const effect of effects) {
    assert.doesNotMatch(effect.split('}, [')[0], /runRef\.current\?\.\(|void run\(/)
  }
  assert.match(EVALUATION_HOOK, /runRef\.current = run\s+void load\(0\)/)
  assert.match(EVALUATION_HOOK, /const allowed = rerun\s+\? canStartReevaluation\(current\.data, current\.running\)\s+: canStartFirstEvaluation\(current\.data, current\.running\)/)
  assert.match(EVALUATION_HOOK, /if \(inFlight\) return/)
})

test('the hook polls only while a run is active, with a limit', () => {
  assert.match(EVALUATION_HOOK, /const POLL_MS = 4000/)
  assert.match(EVALUATION_HOOK, /const MAX_POLLS = 75/)
  assert.match(EVALUATION_HOOK, /if \(data\.in_progress\) poll\(count\)/)
  assert.match(EVALUATION_HOOK, /if \(count >= MAX_POLLS\)/)
})

// -- proof documents ------------------------------------------------------------------------

test('only plain files inside the request folder are opened', () => {
  assert.equal(proofFileName(RID, `${RID}/medical report.pdf`), 'medical report.pdf')
  for (const bad of ['STUD_INCRQ_INC2_900002/a.pdf', `${RID}/nested/a.pdf`, `${RID}/../a.pdf`, `${RID}/..`, `${RID}/`,
    `${RID}/a\\b.pdf`, `${RID}/a\n.pdf`, `incomplete-exam-proofs/${RID}/a.pdf`, null, undefined, '']) {
    assert.equal(proofFileName(RID, bad), null, String(bad))
  }
})

test('only PDFs and images are opened, never HTML, SVG or scripts', () => {
  assert.equal(proofMimeType('a.PDF'), 'application/pdf')
  assert.equal(proofMimeType('a.jpeg'), 'image/jpeg')
  assert.equal(proofMimeType('a.webp'), 'image/webp')
  for (const bad of ['a.html', 'a.htm', 'a.svg', 'a.js', 'a.exe', '.pdf', 'pdf', 'a.pdf.html']) {
    assert.equal(proofMimeType(bad), null, bad)
  }
})

test('the downloaded content must match its type', () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)])
  assert.equal(proofContentMatches('application/pdf', bytes(0x25, 0x50, 0x44, 0x46, 0x2d)), true)
  assert.equal(proofContentMatches('application/pdf', bytes(0x3c, 0x68, 0x74, 0x6d, 0x6c)), false)   // "<html"
  assert.equal(proofContentMatches('image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), true)
  assert.equal(proofContentMatches('image/jpeg', bytes(0xff, 0xd8, 0xff)), true)
  assert.equal(proofContentMatches('image/webp', bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)), true)
  assert.equal(proofContentMatches('text/html', bytes(0x3c)), false)
})

test('proofs are downloaded privately with the staff session and re-typed before opening', () => {
  assert.equal(PROOF_BUCKET, 'incomplete-exam-proofs')
  assert.match(SERVICE, /supabase\.storage\.from\(PROOF_BUCKET\)\.download\(path\)/)
  const open = SERVICE.slice(SERVICE.indexOf('export async function openProofDocument'))
  assert.ok(open.indexOf('proofFileName(requestId, path)') < open.indexOf('.download(path)'))
  assert.ok(open.indexOf('proofMimeType(name)') < open.indexOf('.download(path)'))
  assert.ok(open.indexOf('proofContentMatches(') < open.indexOf('URL.createObjectURL('))
  assert.match(open, /new Blob\(\[data\], \{ type: mimeType \}\)/)
  assert.match(open, /revoke: \(\) => URL\.revokeObjectURL\(url\)/)
})

// -- staff decision ----------------------------------------------------------------------------

test('decisions go only through decide_incomplete_exam_request, without a staff ID', () => {
  assert.match(SERVICE, /supabase\.rpc\('decide_incomplete_exam_request', \{\s+p_request_id: requestId,\s+p_decision: choice,\s+p_explanation: explanation\.trim\(\),\s+\}\)/)
  assert.doesNotMatch(SERVICE, /p_staff|Staff_ID:|\.from\('Decision'\)\.(insert|update|upsert)|\.from\('Request'\)\.(update|upsert|insert)/)
})

test('every refusal of decide_incomplete_exam_request has a safe message', () => {
  for (const code of ['not_staff', 'invalid_decision', 'explanation_required', 'explanation_too_long',
    'request_not_found', 'not_incomplete_exam', 'incomplete_exam_details_missing', 'already_decided']) {
    assert.equal(incompleteExamDecisionErrorCode({ message: code, code: 'P0001' }), code)
    assert.equal(incompleteExamDecisionErrorMessage(code), INCOMPLETE_EXAM_DECISION_MESSAGES[code])
  }
  assert.equal(incompleteExamDecisionErrorCode({ message: 'JWT expired', code: 'PGRST301' }), 'signed_out')
  assert.equal(incompleteExamDecisionErrorCode({ message: 'permission denied for function x' }), 'signed_out')
  assert.equal(incompleteExamDecisionErrorCode({ message: 'something else' }), 'unknown')
  assert.equal(incompleteExamDecisionErrorMessage('unknown'), UNKNOWN_DECISION_MESSAGE)
  assert.equal(incompleteExamDecisionErrorCode(null), 'unknown')
})

test('the explanation rules are the shared 1-2000 character rules', () => {
  assert.match(explanationError('', true) ?? '', /Enter an explanation/)
  assert.equal(explanationError('x'.repeat(2000), true), null)
  assert.notEqual(explanationError('x'.repeat(2001), true), null)
})

test('a decision differing from the advisory recommendation is flagged; MANUAL_REVIEW always differs', () => {
  assert.equal(differsFromRecommendation('approve', 'APPROVE'), false)
  assert.equal(differsFromRecommendation('reject', 'REJECT'), false)
  assert.equal(differsFromRecommendation('approve', 'REJECT'), true)
  assert.equal(differsFromRecommendation('reject', 'APPROVE'), true)
  assert.equal(differsFromRecommendation('approve', 'MANUAL_REVIEW'), true)
  assert.equal(differsFromRecommendation(null, 'APPROVE'), false)
  assert.equal(differsFromRecommendation('approve', null), false)
})

test('missing or failed AI evaluations warn but never block the decision', () => {
  const base = { loading: false, hasCompleted: true, latestFailed: false, running: false, unavailable: false }
  assert.equal(evaluationWarning(base), null)
  assert.equal(evaluationWarning({ ...base, loading: true, hasCompleted: false }), null)
  assert.match(evaluationWarning({ ...base, unavailable: true }) ?? '', /could not be loaded/)
  assert.match(evaluationWarning({ ...base, running: true }) ?? '', /still running/)
  assert.match(evaluationWarning({ ...base, hasCompleted: false }) ?? '', /no completed AI evaluation/)
  assert.match(evaluationWarning({ ...base, hasCompleted: false, latestFailed: true }) ?? '', /failed/)
})

// -- review page display rules ----------------------------------------------------------------

const RESULTS: IncompleteExamDeterministicResults = {
  enrollment: { found: true, grade: 'I' },
  submission_window: { satisfied: true, missed_exam_date: '2026-11-02', request_date: '2026-11-04',
    working_days_elapsed: 2, limit_working_days: 3, holiday_calendar_checked: false },
  proof: { required: true, provided: true, file_attached: true, file_count: 1, file_source: 'storage' },
  exam_type: { value: 'Final', excluded: false, excluded_values_confirmed: true },
}

function completedRun(overrides: Partial<IncompleteExamRun> = {}): IncompleteExamRun {
  return { id: 1, run_status: 'completed', trigger: 'first_open', started_at: null, finished_at: null,
    recommendation: 'REJECT', recommendation_conflict: false, assessment_model: null, rejection_model: null,
    agent_version: '1.2.0', failure_kind: null, error_message: null, ...overrides }
}

test('the verified checks: four database checks, passing, failing or unconfirmed', () => {
  assert.equal(verifiedChecks(null), null)
  const passing = verifiedChecks(RESULTS)!
  assert.deepEqual(passing.map((c) => [c.key, c.tone]),
    [['enrollment', 'pass'], ['submission_window', 'pass'], ['proof', 'pass'], ['exam_type', 'pass']])
  assert.equal(passing[1].value, '2 / 3 working days')
  assert.match(passing[1].detail, /Public holidays were not taken into account/)
  assert.equal(passing[2].value, '1 file read')

  const failing = verifiedChecks({ ...RESULTS, enrollment: { found: false, grade: null },
    submission_window: { ...RESULTS.submission_window, satisfied: false, holiday_calendar_checked: true },
    proof: { ...RESULTS.proof, file_attached: false, file_count: 0 },
    exam_type: { value: 'Quiz', excluded: true, excluded_values_confirmed: false } })!
  assert.deepEqual(failing.map((c) => c.tone), ['fail', 'fail', 'fail', 'fail'])
  assert.doesNotMatch(failing[1].detail, /holidays/)
  assert.match(failing[3].detail, /not confirmed/)

  const unconfirmed = verifiedChecks({ ...RESULTS, proof: { ...RESULTS.proof, required: false, file_attached: false },
    exam_type: { value: null, excluded: null, excluded_values_confirmed: true } })!
  assert.equal(unconfirmed[2].tone, 'unknown')
  assert.equal(unconfirmed[3].tone, 'unknown')
})

test('all five check explanations are shown, in order', () => {
  assert.deepEqual(CHECK_EXPLANATION_LABELS.map((c) => c.key),
    ['enrollment', 'submission_window', 'proof', 'reason_validity', 'exam_type'])
})

test('suggested reasons appear only for REJECT, with their tones and a reason when unavailable', () => {
  assert.equal(rejectionSuggestions(completedRun({ recommendation: 'APPROVE' })), null)
  assert.equal(rejectionSuggestions(completedRun({ recommendation: 'MANUAL_REVIEW' })), null)
  assert.equal(rejectionSuggestions(null), null)

  const ok = rejectionSuggestions(completedRun({ rejection_explanation: {
    status: 'ok', judgment_keywords: [], conflict_note: '  ',
    deterministic_keywords: [{ keyword: 'late', label: 'Submitted late', policy_basis: 'x' }],
    suggested_reasons: [
      { tone: 'formal', text: ' Formal text. ', addresses_keywords: ['late'] },
      { tone: 'concise', text: 'Concise text.', addresses_keywords: ['late'] },
      { tone: 'supportive', text: 'Supportive text.', addresses_keywords: ['late'] },
      { tone: 'formal', text: '   ', addresses_keywords: ['late'] },
    ] } }))!
  assert.deepEqual(ok.reasons.map((r) => [r.label, r.text]),
    [['Formal', 'Formal text.'], ['Concise', 'Concise text.'], ['Supportive', 'Supportive text.']])
  assert.deepEqual(ok.policyReasons, ['Submitted late'])
  assert.equal(ok.conflictNote, null)
  assert.equal(ok.message, null)

  const fallback = rejectionSuggestions(completedRun({ rejection_explanation: {
    status: 'fallback', judgment_keywords: [], conflict_note: 'Note.', deterministic_keywords: [],
    suggested_reasons: [{ tone: 'formal', text: 'Template.', addresses_keywords: [] }] } }))!
  assert.match(fallback.message ?? '', /verified checks only/)
  assert.equal(fallback.conflictNote, 'Note.')

  for (const status of ['unavailable', 'needs_manual_explanation']) {
    const none = rejectionSuggestions(completedRun({ rejection_explanation: {
      status, judgment_keywords: [], conflict_note: '', deterministic_keywords: [], suggested_reasons: [] } }))!
    assert.equal(none.reasons.length, 0)
    assert.match(none.message ?? '', /Write the explanation yourself/)
  }
  assert.match(rejectionSuggestions(completedRun({ rejection_explanation: null }))?.message ?? '', /yourself/)
})

test('verified (deterministic) and assessed (AI judgment) reasons are kept apart, by label', () => {
  // The reported case, after the fix: a document was attached and
  // judged invalid, so only an AI judgment applies.
  const judged = rejectionSuggestions(completedRun({ rejection_explanation: {
    status: 'ok', conflict_note: '', deterministic_keywords: [],
    judgment_keywords: ['proof_inconsistent_or_unverifiable'],
    suggested_reasons: [{ tone: 'formal', text: 'The document could not be accepted.', addresses_keywords: ['proof_inconsistent_or_unverifiable'] }] } }))!
  assert.deepEqual(judged.policyReasons, [])
  assert.deepEqual(judged.assessedReasons, ['Proof inconsistent or could not be accepted'])

  // Both kinds; unknown ids and duplicates are not shown; raw ids never appear.
  const both = rejectionSuggestions(completedRun({ rejection_explanation: {
    status: 'ok', conflict_note: '',
    deterministic_keywords: [{ keyword: 'late_submission', label: 'Late submission', policy_basis: 'x' }],
    judgment_keywords: ['invalid_reason_personal_travel', 'made_up_keyword', 'invalid_reason_personal_travel',
                        'proof_not_acceptable_category'],
    suggested_reasons: [{ tone: 'concise', text: 'Text.', addresses_keywords: ['late_submission'] }] } }))!
  assert.deepEqual(both.policyReasons, ['Late submission'])
  assert.deepEqual(both.assessedReasons, ['Personal or discretionary travel', 'Proof not in an accepted category'])
  assert.ok(!both.assessedReasons.some((r) => r.includes('_')))

  // Older runs without judgment keywords simply have none.
  const older = rejectionSuggestions(completedRun({ rejection_explanation: {
    status: 'ok', conflict_note: '', deterministic_keywords: [], judgment_keywords: undefined as unknown as string[],
    suggested_reasons: [{ tone: 'formal', text: 'Text.', addresses_keywords: [] }] } }))!
  assert.deepEqual(older.assessedReasons, [])

  // Exactly the backend's closed list of judgment keywords has labels.
  const vocabulary = JSON.parse(readFileSync(new URL(
    '../../backend/app/agents/incomplete_exam/knowledge_base/rejection_keywords.json', import.meta.url), 'utf8')) as {
    keywords: Record<string, { detection: string }>
  }
  const judgmentIds = Object.entries(vocabulary.keywords).filter(([, v]) => v.detection === 'judgment').map(([k]) => k)
  assert.deepEqual(Object.keys(JUDGMENT_REASON_LABELS).sort(), judgmentIds.sort())

  // The panel labels the two kinds separately and marks the AI's as an assessment.
  const panel = readFileSync(new URL('../src/components/incompleteExamReview/EvaluationPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /<strong>Verified reasons:<\/strong> \{suggestions\.policyReasons\.join\('; '\)\}/)
  assert.match(panel, /<strong>Assessed reasons:<\/strong> \{suggestions\.assessedReasons\.join\('; '\)\}/)
  assert.match(panel, /not a verified record/)
})

test('each proof file shows how the last evaluation used it', () => {
  const outcomes = proofOutcomes(completedRun({ proof_files: [
    { path: `${RID}/a.pdf`, outcome: 'attached' },
    { path: `${RID}/b.png`, outcome: 'skipped_too_large' },
    { path: `${RID}/c.pdf`, outcome: 'something_new' },
  ] }))
  assert.equal(outcomes.get(`${RID}/a.pdf`), 'Read by the agent')
  assert.match(outcomes.get(`${RID}/b.png`) ?? '', /too large/)
  assert.equal(outcomes.get(`${RID}/c.pdf`), 'Not read by the agent')
  assert.equal(proofOutcomes(null).size, 0)
})

// -- student decision view --------------------------------------------------------------------

test('a student decision is accepted only with a matching decision record', () => {
  const recorded = { request_id: RID, status: 'Completed', decision: 'approve', has_decision_record: true,
    explanation: ' Approved: the report supports the absence. ', decided_at: '2026-11-07 10:00:00' }
  assert.deepEqual(toIncompleteExamDecisionView(recorded), {
    decision: 'approve', hasDecisionRecord: true,
    explanation: 'Approved: the report supports the absence.', decidedAt: '2026-11-07T10:00:00Z',
  })
  assert.equal(toIncompleteExamDecisionView({ ...recorded, status: 'Rejected', decision: 'reject' })?.decision, 'reject')

  // The corrected function (07): no matching record -> decision null.
  assert.equal(toIncompleteExamDecisionView({ request_id: RID, status: 'Completed', decision: null,
    has_decision_record: false, explanation: null, decided_at: null }), null)
  // The earlier function (04) inferred the outcome from the status: ignored.
  for (const [status, decision] of [['Completed', 'approve'], ['Rejected', 'reject']]) {
    assert.equal(toIncompleteExamDecisionView({ request_id: RID, status, decision,
      has_decision_record: false, explanation: null, decided_at: null }), null, `${status} without a record`)
  }
  // Missing or malformed flags and decisions are never accepted.
  for (const body of [null, undefined, {}, { ...recorded, has_decision_record: undefined },
    { ...recorded, has_decision_record: 'true' }, { ...recorded, decision: null }, { ...recorded, decision: 'APPROVE' }]) {
    assert.equal(toIncompleteExamDecisionView(body), null, JSON.stringify(body))
  }
})

test('students read their own decision only through get_my_incomplete_exam_decision', () => {
  assert.match(STUDENT_SERVICE, /supabase\.rpc\('get_my_incomplete_exam_decision', \{ p_request_id: requestId \}\)/)
  assert.match(STUDENT_SERVICE, /if \(error\) throw error/)
  assert.doesNotMatch(STUDENT_SERVICE, /\.from\(/)
})

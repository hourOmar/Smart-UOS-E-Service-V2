// The Course Equivalency staff review page: routing, the evaluation state machine (automatic
// first run only when eligible, once; reruns only when allowed), the displayed states
// (missing syllabi / details, running, APPROVE / REJECT / MANUAL_REVIEW, failures, preserved
// result, outdated result, draft thresholds), rejection suggestions only for REJECT, and
// static guarantees (the evaluation stays advisory, the decision goes only through the
// database function, no credentials, staff-only routes).
// Run: npm test (no browser, backend or database).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { courseEquivalencyReviewPath, reviewPathFor } from '../src/utils/adminPaths.ts'
import {
  ADVISORY_NOTICE,
  canStartFirstEvaluation,
  canStartReevaluation,
  courseEquivalencyEvaluationPath,
  courseEquivalencyEvaluationsPath,
  draftThresholdsNotice,
  evaluatedFile,
  evaluationPanelView,
  evaluationRequestBody,
  LEGACY_MANUAL_START_NOTICE,
  manualStartRequired,
  matchSummary,
  outdatedMessage,
  rejectionSuggestions,
  safeguardChecks,
  scoreBandLabel,
  shouldAutoRun,
  type CourseEquivalencyEvaluationState,
  type CourseEquivalencyRun,
} from '../src/utils/courseEquivalencyEvaluation.ts'
import { buildCourseEquivalencyRecord, programChangeContext } from '../src/utils/courseEquivalencyRecord.ts'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const APP = source('../src/App.tsx')
const PAGE = source('../src/pages/AdminCourseEquivalencyReview.tsx')
const PANEL = source('../src/components/courseEquivalencyReview/EvaluationPanel.tsx')
const HOOK = source('../src/hooks/useCourseEquivalencyEvaluation.ts')
const SERVICE = source('../src/services/courseEquivalencyReview.ts')
const UTIL = source('../src/utils/courseEquivalencyEvaluation.ts')

const RID = 'STUD_EQVO_ECTU_000139'

function state(overrides: Partial<CourseEquivalencyEvaluationState> = {}): CourseEquivalencyEvaluationState {
  return {
    request_id: RID, request_status: 'In Progress', details_missing: false, details_missing_message: null,
    syllabi_ready: true, syllabi_missing_message: null, current_syllabi: { old: 'o1', new: 'n1' },
    policy_status: 'draft_thresholds', current: null, latest_attempt: null, in_progress: false, run_count: 0,
    current_syllabus_sources: { old: 'staff_upload', new: 'staff_upload' },
    first_run_eligible: true, auto_run_eligible: true, manual_start_reason: null, can_rerun: true, ...overrides,
  }
}

const similarity = {
  overall_similarity_percent: 54.2, score_band: 'BELOW_RANGE' as const, thresholds: { equivalent_min: 80, review_min: 60 },
  components_percent: { topics: 40, learning_outcomes: 50, assessment_structure: 90, credit_hours: 100 },
  verification_ok: true, match_verification: { claimed_total: 6, dropped_total: 1, dropped_percent: 16.7 },
  credit_hours: { old: 3, new: 3, old_covers_new: true, note: null },
  new_topics_not_covered: ['Recursion', 'Trees'], new_outcomes_not_covered: [],
}

function run(overrides: Partial<CourseEquivalencyRun> = {}): CourseEquivalencyRun {
  return {
    id: 1, run_status: 'completed', trigger: 'first_open', started_at: '2026-11-17T08:00:00Z', finished_at: '2026-11-17T08:01:00Z',
    recommendation: 'APPROVE', reasoning: 'Synthetic reasoning.',
    check_explanations: [{ name: 'content_similarity', status: 'PASS', explanation: 'Covered.' }],
    deterministic_results: {
      constraints: {
        minimum_grade: { required: 'C+', grade: 'B+', meets: true },
        study_plan: { program_checked: 'Bachelor of Science in Computer Science', in_plan: true, note: null, program_change: { new_program_name: 'Bachelor of Science in Computer Science', result: 'approved' } },
        credit_hours: { old: 3, new: 3, old_covers_new: true },
        transfer_limit: { already_transferred: 0, this_request_adds: 3, total_after: 3, cap_credit_hours: 60, college: 'College of Computing and Informatics', within_limit: true, note: 'Community college transfers are capped.' },
        gpa_impact: 'Transferred credits appear as grade TR and do not count in the CGPA.',
      },
      academic_level: { old_level: 1, new_level: 1, old_at_least_new: true },
      old_course: { course_id: '1440133', name: 'Calculus I for Engineers', credit_hours: 3, in_transcript: true, grade: 'B+', grade_source: 'transcript', passed: true, term: 202410 },
      new_course: { course_id: '1440131', name: 'Calculus I', credit_hours: 3 },
      syllabi: { old: { available: true, readable: true, error: null }, new: { available: true, readable: true, error: null } },
      syllabus_request: null, similarity, text_overlap_percent: 61.5,
    },
    evidence: {}, evaluated_syllabi: [
      { syllabus_id: 'o1', side: 'old', storage_path: `${RID}/old/o1.pdf`, file_name: 'Calc.pdf', mime_type: 'application/pdf', size_bytes: 1000, sha256: 'a'.repeat(64), source: 'staff_upload', text_chars: 4000 },
      { syllabus_id: 'n1', side: 'new', storage_path: `${RID}/new/n1.docx`, file_name: 'Calc I.docx', mime_type: 'x', size_bytes: 900, sha256: 'b'.repeat(64), source: 'staff_upload', text_chars: 3000 },
    ],
    outdated: false, outdated_sides: [], rejection_explanation: null, assessment_model: 'gemini-x', rejection_model: null,
    agent_version: '1.0.0', failure_kind: null, error_message: null, ...overrides,
  }
}

// --------------------------------------------------------------------------- routing
test('Course Equivalency requests open their review page from search and lists', () => {
  assert.equal(courseEquivalencyReviewPath(RID), `/admin/requests/course-equivalency/${RID}`)
  assert.equal(reviewPathFor('Course Equivalency', RID), `/admin/requests/course-equivalency/${RID}`)
  assert.match(APP, /path="\/admin\/requests\/course-equivalency\/:requestId"[\s\S]*?<ProtectedRoute requiredRole="admin">\s*<AdminCourseEquivalencyReview \/>/)
  // declared before the generic type-list route, so it is not shadowed
  assert.ok(APP.indexOf('/admin/requests/course-equivalency/:requestId') < APP.indexOf('/admin/requests/:typeId'))
  assert.match(PAGE, /<ReviewBreadcrumb typeId="course-equivalency" \/>/)
  assert.match(PAGE, /origin === 'dashboard'[\s\S]*ADMIN_HOME_PATH[\s\S]*adminTypePath\('course-equivalency'\)/)
})

test('evaluation endpoints and body', () => {
  assert.equal(courseEquivalencyEvaluationPath(RID), `/api/staff/course-equivalency/${RID}/evaluation`)
  assert.equal(courseEquivalencyEvaluationsPath(RID), `/api/staff/course-equivalency/${RID}/evaluations`)
  assert.equal(evaluationRequestBody(true), '{"rerun":true}')
})

// --------------------------------------------------------------------------- triggering
test('the first evaluation starts automatically only when eligible, and only once', () => {
  const none = new Set<string>()
  assert.equal(shouldAutoRun(RID, state(), false, none), true)
  assert.equal(shouldAutoRun(RID, state(), false, new Set([RID])), false, 'never twice on this page')
  assert.equal(shouldAutoRun(RID, state(), true, none), false, 'not while this page is running one')
  assert.equal(shouldAutoRun(RID, state({ in_progress: true }), false, none), false, 'not while another run is going')
  assert.equal(shouldAutoRun(RID, state({ auto_run_eligible: false }), false, none), false, 'only when the backend says so')
  assert.equal(shouldAutoRun(RID, null, false, none), false)
  assert.match(HOOK, /autoRequested\.current\.has\(requestId\)/)
  assert.match(HOOK, /autoRequested\.current\.add\(requestId\)/)
})

test('re-evaluation only when the backend allows it and nothing is running', () => {
  assert.equal(canStartReevaluation(state({ can_rerun: true }), false), true)
  assert.equal(canStartReevaluation(state({ can_rerun: false }), false), false)
  assert.equal(canStartReevaluation(state({ in_progress: true }), false), false)
  assert.equal(canStartReevaluation(state(), true), false)
  assert.equal(canStartFirstEvaluation(state({ first_run_eligible: false, auto_run_eligible: false }), false), false)
})

// --------------------------------------------------------------------------- legacy syllabi
const LEGACY = {
  current_syllabus_sources: { old: 'legacy_import', new: 'legacy_import' },
  first_run_eligible: true,
  auto_run_eligible: false,
  manual_start_reason: 'legacy_syllabi',
} as const

test('legacy-only syllabi: never started automatically, but staff can run the evaluation', () => {
  const none = new Set<string>()
  const legacy = state(LEGACY)
  assert.equal(shouldAutoRun(RID, legacy, false, none), false, 'no automatic Gemini run')
  assert.equal(canStartFirstEvaluation(legacy, false), true, 'the Run Evaluation button is offered')
  assert.equal(canStartFirstEvaluation(legacy, true), false, 'not while this page is running one')
  assert.equal(canStartFirstEvaluation(state({ ...LEGACY, in_progress: true }), false), false)
  assert.equal(manualStartRequired(legacy), true)
  const view = evaluationPanelView('ready', legacy, false)
  assert.equal(view.stage, 'not_evaluated')
  assert.equal(view.manualStartRequired, true)
  // Defence in depth: even if auto_run_eligible were reported, a manual-start reason wins.
  assert.equal(shouldAutoRun(RID, state({ ...LEGACY, auto_run_eligible: true }), false, none), false)
})

test('newly uploaded syllabi keep the automatic first evaluation', () => {
  const none = new Set<string>()
  for (const sources of [
    { old: 'staff_upload', new: 'staff_upload' },
    { old: 'legacy_import', new: 'staff_upload' },
    { old: 'staff_upload', new: 'legacy_import' },
  ] as const) {
    const fresh = state({ current_syllabus_sources: sources })
    assert.equal(shouldAutoRun(RID, fresh, false, none), true, `${sources.old}/${sources.new} starts automatically`)
    assert.equal(manualStartRequired(fresh), false)
    assert.equal(evaluationPanelView('ready', fresh, false).manualStartRequired, false)
  }
})

test('the manual-start rule never relaxes eligibility', () => {
  const none = new Set<string>()
  const ineligible = state({ ...LEGACY, first_run_eligible: false, manual_start_reason: null })
  assert.equal(canStartFirstEvaluation(ineligible, false), false)
  assert.equal(shouldAutoRun(RID, ineligible, false, none), false)
  assert.equal(manualStartRequired(state({ ...LEGACY, first_run_eligible: false })), false)
  assert.equal(canStartReevaluation(state({ ...LEGACY, can_rerun: false }), false), false)
})

test('the panel explains legacy syllabi and offers a Run Evaluation button', () => {
  assert.match(PANEL, /view\.manualStartRequired\s*\?\s*LEGACY_MANUAL_START_NOTICE/)
  assert.match(PANEL, />\s*Run Evaluation\s*</)
  assert.match(LEGACY_MANUAL_START_NOTICE, /earlier upload system/)
  assert.match(LEGACY_MANUAL_START_NOTICE, /Run Evaluation/)
  assert.doesNotMatch(UTIL, /STUD_[A-Z]+_[A-Z0-9]+_\d+/, 'no hardcoded request IDs')
})

// --------------------------------------------------------------------------- states
test('missing syllabi, missing details and loading / error states', () => {
  assert.equal(evaluationPanelView('loading', null, false).stage, 'loading')
  assert.equal(evaluationPanelView('error', null, false).stage, 'error')
  const missing = evaluationPanelView('ready', state({ syllabi_ready: false, auto_run_eligible: false, can_rerun: false }), false)
  assert.equal(missing.stage, 'syllabi_missing')
  assert.equal(missing.syllabiMissing, true)
  const details = evaluationPanelView('ready', state({ details_missing: true, auto_run_eligible: false }), false)
  assert.equal(details.stage, 'details_missing')
  assert.equal(evaluationPanelView('ready', state(), false).stage, 'not_evaluated')
})

test('running takes precedence (this page or another session)', () => {
  assert.equal(evaluationPanelView('ready', state(), true).stage, 'running')
  assert.equal(evaluationPanelView('ready', state({ in_progress: true, current: run() }), false).stage, 'running')
})

test('completed APPROVE, REJECT and MANUAL_REVIEW results', () => {
  for (const recommendation of ['APPROVE', 'REJECT', 'MANUAL_REVIEW'] as const) {
    const view = evaluationPanelView('ready', state({ current: run({ recommendation }) }), false)
    assert.equal(view.stage, 'result')
    assert.equal(view.current?.recommendation, recommendation)
  }
  assert.match(ADVISORY_NOTICE, /advisory/i)
  assert.match(ADVISORY_NOTICE, /final decision belongs to the administrator/)
})

test('a failed first evaluation, and a failed rerun that keeps the last successful result', () => {
  const failed = run({ id: 2, run_status: 'failed', recommendation: null, failure_kind: 'technical', error_message: 'The AI service was unavailable.' })
  const first = evaluationPanelView('ready', state({ latest_attempt: failed }), false)
  assert.equal(first.stage, 'failed')
  assert.equal(first.preservedAfterFailure, false)
  const kept = evaluationPanelView('ready', state({ current: run(), latest_attempt: failed }), false)
  assert.equal(kept.stage, 'result')
  assert.equal(kept.preservedAfterFailure, true)
  assert.equal(kept.current?.recommendation, 'APPROVE')
  const interrupted = evaluationPanelView('ready', state({ latest_attempt: { ...failed, run_status: 'interrupted' } }), false)
  assert.equal(interrupted.stage, 'failed')
})

test('an outdated result after a syllabus replacement', () => {
  const view = evaluationPanelView('ready', state({ current: run({ outdated: true, outdated_sides: ['new'] }) }), false)
  assert.equal(view.outdated, true)
  assert.deepEqual(view.outdatedSides, ['new'])
  assert.match(outdatedMessage(['new']), /new-course syllabus was replaced/)
  assert.match(outdatedMessage(['old', 'new']), /Both syllabi were replaced/)
  assert.match(PANEL, /view\.outdated/)
})

test('draft thresholds notice', () => {
  assert.equal(evaluationPanelView('ready', state(), false).draftThresholds, true)
  assert.equal(evaluationPanelView('ready', state({ policy_status: 'approved' }), false).draftThresholds, false)
  assert.match(draftThresholdsNotice(similarity), /80% equivalent, 60% review/)
  assert.match(draftThresholdsNotice(null), /draft/)
})

test('a finalized request offers no evaluation', () => {
  assert.equal(evaluationPanelView('ready', state({ request_status: 'Completed', auto_run_eligible: false, can_rerun: false }), false).finalized, true)
})

// --------------------------------------------------------------------------- displayed results
test('academic safeguards, similarity breakdown and uncovered topics', () => {
  const checks = safeguardChecks(run().deterministic_results)!
  assert.deepEqual(checks.map((c) => c.key), ['minimum_grade', 'study_plan', 'credit_hours', 'transfer_limit', 'academic_level'])
  assert.equal(checks.find((c) => c.key === 'transfer_limit')?.value, '3 of 60')
  const failing = run()
  failing.deterministic_results!.constraints.minimum_grade = { required: 'C+', grade: 'C', meets: false }
  failing.deterministic_results!.constraints.study_plan.in_plan = null
  const tones = Object.fromEntries(safeguardChecks(failing.deterministic_results)!.map((c) => [c.key, c.tone]))
  assert.equal(tones.minimum_grade, 'fail')
  assert.equal(tones.study_plan, 'unknown')
  assert.equal(scoreBandLabel(similarity), 'Below 60%')
  assert.equal(scoreBandLabel({ ...similarity, score_band: 'EQUIVALENT_RANGE' }), 'Equivalent range (at least 80%)')
  assert.match(matchSummary(similarity)!, /5 of 6/)
  assert.equal(safeguardChecks(null), null)
  assert.match(PANEL, /new_topics_not_covered/)
  assert.equal(evaluatedFile(run(), 'new')?.file_name, 'Calc I.docx')
})

test('rejection suggestions only for a completed REJECT', () => {
  const explanation = {
    status: 'ok', notes: [],
    keywords: [{ id: 'grade_below_minimum', type: 'verified', description: 'Grade below the minimum.' },
               { id: 'different_course_focus', type: 'judged', description: 'Different focus.' }],
    suggested_reasons: [{ tone: 'formal', text: 'Your grade is below the minimum.', addresses_keywords: ['grade_below_minimum'] }],
  }
  const shown = rejectionSuggestions(run({ recommendation: 'REJECT', rejection_explanation: explanation }))!
  assert.deepEqual(shown.verified, ['Grade below the minimum.'])
  assert.deepEqual(shown.judged, ['Different focus.'])
  assert.equal(shown.reasons[0].label, 'Formal')
  assert.equal(rejectionSuggestions(run({ recommendation: 'APPROVE', rejection_explanation: explanation })), null)
  assert.equal(rejectionSuggestions(run({ recommendation: 'MANUAL_REVIEW', rejection_explanation: explanation })), null)
  assert.equal(rejectionSuggestions(run({ recommendation: 'REJECT', rejection_explanation: null })), null)
  const fallback = rejectionSuggestions(run({ recommendation: 'REJECT', rejection_explanation: { ...explanation, status: 'fallback' } }))!
  assert.match(fallback.statusNote!, /verified facts/)
})

// --------------------------------------------------------------------------- request record
test('the record shows the request and its Program Change context', () => {
  const rec = buildCourseEquivalencyRecord({
    request: { Request_ID: RID, Request_Type: 'Course Equivalency', Current_Status: 'In Progress', Request_Date: '2026-11-15', Student_ID: 'U24299999' },
    details: { Old_Course_ID: '1440133', New_Course_ID: '1440131', Reason: 'Same content.', Program_Change_Request_ID: 'STUD_CPSR_CHP3_000048',
               Old_Program_ID: '1502', Old_Program_Name: 'Computer Engineering', New_Program_ID: '1501', New_Program_Name: 'Computer Science',
               Plan_Version: 'CS-WEB-2026-10-31', Old_Course_Grade: 'B+', Old_Course_Term: 202410 },
    courses: [{ Course_ID: '1440133', Course_Name: 'Calculus I for Engineers', Credit_Hours: 3 }, { Course_ID: '1440131', Course_Name: 'Calculus I', Credit_Hours: 3 }],
    student: { Student_ID: 'U24299999', Student_Name: 'Synthetic', Program_Name: 'Computer Engineering', Program: { College_Name: 'College of Computing and Informatics' } },
    programChange: { Current_Program_Name: 'Computer Engineering', New_Program_Name: 'Computer Science' },
    programChangeRequest: { Current_Status: 'Completed', Request_Date: '2026-11-10' },
    history: null,
  })
  assert.equal(rec.details?.oldCourse.name, 'Calculus I for Engineers')
  assert.equal(rec.details?.newCourse.creditHours, 3)
  assert.equal(rec.programChange?.status, 'Completed')
  assert.match(programChangeContext(rec), /STUD_CPSR_CHP3_000048: Computer Engineering → Computer Science \(study plan CS-WEB-2026-10-31\)/)
  const legacy = buildCourseEquivalencyRecord({ request: { Request_ID: 'x' }, details: { Old_Course_ID: '1', New_Course_ID: '2' }, courses: [],
                                                student: null, programChange: null, programChangeRequest: null, history: null })
  assert.match(programChangeContext(legacy), /No Program Change was linked/)
  assert.equal(legacy.programChange, null)
})

// --------------------------------------------------------------------------- static guarantees
test('the evaluation stays advisory; the decision is only the database function; no TR creation', () => {
  // The evaluation panel never decides.
  assert.doesNotMatch(PANEL, /\.rpc\(|decide_/)
  for (const code of [PAGE, PANEL, SERVICE]) {
    assert.doesNotMatch(code, /from\('Takes'\)/)
    assert.doesNotMatch(code, /\.(insert|update|upsert|delete)\(/)
  }
  // The page holds no decision call itself (the decision panel does, through the service),
  // and the service's only database function call is decide_course_equivalency_request.
  assert.doesNotMatch(PAGE, /\.rpc\(|decide_/)
  assert.deepEqual(SERVICE.match(/\.rpc\('[a-z_]+'/g), [".rpc('decide_course_equivalency_request'"])
  assert.doesNotMatch(PAGE, /not available on this page yet/)
  assert.match(PAGE, /<DecisionPanel key=\{found\.request\.id\} record=\{found\} readiness=\{readiness\} onChanged=\{afterDecision\} \/>/)
})

test('no credentials or service keys in the frontend code', () => {
  for (const code of [PAGE, PANEL, SERVICE, HOOK]) {
    assert.doesNotMatch(code, /service_role|SERVICE_ROLE|SUPABASE_SERVICE|sb_secret/)
    assert.doesNotMatch(code, /createSignedUrl|getPublicUrl/)
    assert.doesNotMatch(code, /localStorage|sessionStorage/)
  }
  // The token is taken from the session per call and only placed in the Authorization header.
  assert.match(SERVICE, /setRequestHeader\('Authorization', `Bearer \$\{token\}`\)/)
})

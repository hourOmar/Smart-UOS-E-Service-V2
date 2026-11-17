// The Course Equivalency evaluation state returned by the staff backend
// (GET /api/staff/course-equivalency/{id}/evaluation, POST .../evaluations). Pure
// functions only (no network, no Supabase), so they can be tested with `npm test`.

export type CourseEquivalencyRecommendation = 'APPROVE' | 'REJECT' | 'MANUAL_REVIEW'
export type SyllabusSide = 'old' | 'new'

/** One syllabus the run evaluated: a REFERENCE only (never the file or its text). */
export interface EvaluatedSyllabus {
  syllabus_id: string
  side: SyllabusSide
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  sha256: string
  source: string
  text_chars: number
}

export interface CourseEquivalencyConstraints {
  minimum_grade: { required: string; grade: string | null; meets: boolean | null }
  study_plan: {
    program_checked: string | null
    in_plan: boolean | null
    note: string | null
    program_change: { new_program_name?: string | null; result?: string; status?: string | null } | null
  }
  credit_hours: { old: number | null; new: number | null; old_covers_new: boolean | null }
  transfer_limit: {
    already_transferred: number
    this_request_adds: number | null
    total_after: number | null
    cap_credit_hours: number
    college: string | null
    within_limit: boolean | null
    note: string
  }
  gpa_impact: string
}

export interface CourseEquivalencySimilarity {
  overall_similarity_percent: number | null
  score_band: 'EQUIVALENT_RANGE' | 'REVIEW_RANGE' | 'BELOW_RANGE' | null
  thresholds: { equivalent_min: number; review_min: number }
  components_percent: {
    topics: number | null
    learning_outcomes: number | null
    assessment_structure: number | null
    credit_hours: number | null
  }
  verification_ok: boolean | null
  match_verification: { claimed_total: number; dropped_total: number; dropped_percent: number } | null
  credit_hours: { old: number | null; new: number | null; old_covers_new: boolean | null; note: string | null }
  new_topics_not_covered: string[]
  new_outcomes_not_covered: string[]
  extracted?: Record<SyllabusSide, { title: string; credit_hours: number | null }>
}

export interface CourseEquivalencyDeterministicResults {
  constraints: CourseEquivalencyConstraints
  academic_level: { old_level: number | null; new_level: number | null; old_at_least_new: boolean | null }
  old_course: {
    course_id: string | null
    name: string | null
    credit_hours: number | null
    in_catalog?: boolean
    in_transcript: boolean
    grade: string | null
    grade_source: string | null
    passed: boolean | null
    term: number | null
  }
  new_course: { course_id: string | null; name: string | null; credit_hours: number | null; in_catalog?: boolean }
  syllabi: Record<SyllabusSide, { available: boolean; readable: boolean; error: string | null }>
  syllabus_request: string | null
  similarity: CourseEquivalencySimilarity | null
  text_overlap_percent: number | null
}

export interface CourseEquivalencyCheckExplanation {
  name: string
  status: 'PASS' | 'FAIL' | 'N/A' | string
  explanation: string
}

export interface CourseEquivalencyRejectionExplanation {
  status: 'ok' | 'fallback' | 'unavailable' | 'needs_manual_explanation' | 'not_applicable' | string
  keywords: { id: string; type: 'verified' | 'judged' | string; description: string }[]
  suggested_reasons: { tone: string; text: string; addresses_keywords: string[] }[]
  notes: string[]
}

export interface CourseEquivalencyRun {
  id: number
  run_status: 'running' | 'completed' | 'failed' | 'interrupted'
  trigger: 'first_open' | 'rerun'
  started_at: string | null
  finished_at: string | null
  recommendation: CourseEquivalencyRecommendation | null
  reasoning: string | null
  check_explanations: CourseEquivalencyCheckExplanation[] | null
  deterministic_results: CourseEquivalencyDeterministicResults | null
  evidence: Record<string, unknown> | null
  evaluated_syllabi: EvaluatedSyllabus[] | null
  outdated: boolean
  outdated_sides: SyllabusSide[]
  rejection_explanation: CourseEquivalencyRejectionExplanation | null
  assessment_model: string | null
  rejection_model: string | null
  agent_version: string | null
  failure_kind: 'data' | 'technical' | 'interrupted' | null
  error_message: string | null
}

export interface CourseEquivalencyEvaluationState {
  request_id: string
  request_status: string
  details_missing: boolean
  details_missing_message: string | null
  syllabi_ready: boolean
  syllabi_missing_message: string | null
  current_syllabi: Record<SyllabusSide, string | null>
  policy_status: string | null
  current: CourseEquivalencyRun | null
  latest_attempt: CourseEquivalencyRun | null
  in_progress: boolean
  run_count: number
  /** Where each current syllabus came from (registry metadata). */
  current_syllabus_sources: Record<SyllabusSide, SyllabusSource | null>
  /** A first evaluation may be started (never evaluated, In Progress, details and both syllabi present). */
  first_run_eligible: boolean
  /** ...and the page may start it on its own (false when a manual start is required). */
  auto_run_eligible: boolean
  /** Why the first evaluation must be started by staff: 'legacy_syllabi' when both current
   *  syllabi were imported from the earlier upload system. */
  manual_start_reason: ManualStartReason | null
  can_rerun: boolean
}

export type SyllabusSource = 'staff_upload' | 'legacy_import'
export type ManualStartReason = 'legacy_syllabi'

export interface CourseEquivalencyRunResponse extends CourseEquivalencyEvaluationState {
  started_by_this_call: boolean
  outcome: string
}

const BASE = '/api/staff/course-equivalency'

export const courseEquivalencyEvaluationPath = (requestId: string) =>
  `${BASE}/${encodeURIComponent(requestId)}/evaluation`

export const courseEquivalencyEvaluationsPath = (requestId: string) =>
  `${BASE}/${encodeURIComponent(requestId)}/evaluations`

export const evaluationRequestBody = (rerun: boolean) => JSON.stringify({ rerun })

/** The first evaluation may be started by staff: the backend reports it eligible (never
 *  evaluated, In Progress, details and both syllabi present) and nothing is running. This
 *  includes requests whose syllabi are legacy imports, which are never started automatically. */
export function canStartFirstEvaluation(data: CourseEquivalencyEvaluationState | null, running: boolean): boolean {
  return Boolean(data && data.first_run_eligible && !data.in_progress && !running)
}

/** Staff must start the first evaluation themselves (both syllabi are legacy imports). */
export function manualStartRequired(data: CourseEquivalencyEvaluationState | null): boolean {
  return Boolean(data && data.first_run_eligible && data.manual_start_reason != null)
}

/** A re-evaluation may start: the backend allows it and nothing is running. */
export function canStartReevaluation(data: CourseEquivalencyEvaluationState | null, running: boolean): boolean {
  return Boolean(data && data.can_rerun && !data.in_progress && !running)
}

/** The page starts the first evaluation automatically at most once per request, only when
 *  the backend reports it eligible for an AUTOMATIC start, and never when a manual start is
 *  required (legacy syllabi). */
export function shouldAutoRun(
  requestId: string,
  data: CourseEquivalencyEvaluationState | null,
  running: boolean,
  alreadyRequested: ReadonlySet<string>,
): boolean {
  return Boolean(
    data &&
      data.auto_run_eligible === true &&
      data.manual_start_reason == null &&
      canStartFirstEvaluation(data, running) &&
      !alreadyRequested.has(requestId),
  )
}

export type EvaluationStage =
  | 'loading'
  | 'error'
  | 'running'
  | 'result'
  | 'failed'
  | 'details_missing'
  | 'syllabi_missing'
  | 'not_evaluated'

export interface EvaluationPanelView {
  stage: EvaluationStage
  current: CourseEquivalencyRun | null
  /** The newest attempt when it failed or was interrupted (and is not the current result). */
  failedAttempt: CourseEquivalencyRun | null
  /** A newer attempt failed; the last successful result is still shown. */
  preservedAfterFailure: boolean
  outdated: boolean
  outdatedSides: SyllabusSide[]
  detailsMissing: boolean
  syllabiMissing: boolean
  draftThresholds: boolean
  finalized: boolean
  /** Not evaluated yet and waiting for staff to start it (legacy syllabi). */
  manualStartRequired: boolean
}

/** What the evaluation panel shows, from the load status, the saved state and whether this
 *  page's own run request is in flight. A running evaluation takes precedence; a completed
 *  result stays visible after a failed re-evaluation. */
export function evaluationPanelView(
  status: 'loading' | 'ready' | 'error',
  data: CourseEquivalencyEvaluationState | null,
  running: boolean,
): EvaluationPanelView {
  const current = data?.current ?? null
  const latest = data?.latest_attempt ?? null
  const failedAttempt =
    latest && (latest.run_status === 'failed' || latest.run_status === 'interrupted') ? latest : null
  const active = running || Boolean(data?.in_progress)
  const view: EvaluationPanelView = {
    stage: 'not_evaluated',
    current,
    failedAttempt,
    preservedAfterFailure: Boolean(current && failedAttempt),
    outdated: Boolean(current?.outdated),
    outdatedSides: current?.outdated_sides ?? [],
    detailsMissing: Boolean(data?.details_missing),
    syllabiMissing: Boolean(data && !data.syllabi_ready),
    draftThresholds: data?.policy_status === 'draft_thresholds',
    finalized: Boolean(data && data.request_status !== 'In Progress'),
    manualStartRequired: manualStartRequired(data),
  }
  if (!data) view.stage = status === 'error' ? 'error' : 'loading'
  else if (active) view.stage = 'running'
  else if (current) view.stage = 'result'
  else if (failedAttempt) view.stage = 'failed'
  else if (data.details_missing) view.stage = 'details_missing'
  else if (!data.syllabi_ready) view.stage = 'syllabi_missing'
  return view
}

export const ADVISORY_NOTICE =
  'Advisory recommendation only — the final decision belongs to the administrator. Nothing here approves or rejects the request, notifies the student or changes the transcript.'

export const LEGACY_MANUAL_START_NOTICE =
  'Both syllabi for this request were imported from the earlier upload system, so the evaluation does not start automatically. Check the syllabi, then select Run Evaluation to start it.'

export function draftThresholdsNotice(similarity: CourseEquivalencySimilarity | null | undefined): string {
  const t = similarity?.thresholds ?? { equivalent_min: 80, review_min: 60 }
  return `The similarity thresholds (${t.equivalent_min}% equivalent, ${t.review_min}% review) are draft values from the agent’s policy and have not been confirmed by the department.`
}

export const RECOMMENDATION_DISPLAY: Record<
  CourseEquivalencyRecommendation,
  { tone: 'approve' | 'reject' | 'review'; glyph: string; label: string; meaning: string }
> = {
  APPROVE: { tone: 'approve', glyph: '✓', label: 'APPROVE', meaning: 'The courses appear equivalent.' },
  REJECT: { tone: 'reject', glyph: '✕', label: 'REJECT', meaning: 'The courses do not appear equivalent.' },
  MANUAL_REVIEW: { tone: 'review', glyph: '!', label: 'MANUAL REVIEW', meaning: 'The agent could not decide; review it yourself.' },
}

export const SIDE_NAMES: Record<SyllabusSide, string> = { old: 'old-course', new: 'new-course' }

export function outdatedMessage(sides: SyllabusSide[]): string {
  const which = sides.length === 2 ? 'Both syllabi were' : `The ${SIDE_NAMES[sides[0] ?? 'old']} syllabus was`
  return `${which} replaced after this evaluation, so it no longer reflects the current files. Re-evaluate to check the current syllabi; the result below is kept for reference.`
}

export const FAILURE_NOTES: Record<string, string> = {
  data: 'The request’s records stopped the evaluation (for example a syllabus file that does not match its registration); evaluating again gives the same result until the data is corrected.',
  technical: 'This is a technical failure, not a recommendation.',
  interrupted: 'The evaluation did not finish. This is a technical failure, not a recommendation.',
}

export type CheckTone = 'pass' | 'fail' | 'unknown'
const tone = (value: boolean | null | undefined): CheckTone => (value === true ? 'pass' : value === false ? 'fail' : 'unknown')

export interface SafeguardCheck {
  key: string
  name: string
  tone: CheckTone
  value: string
  detail: string
}

const n = (value: number | null | undefined) => (value === null || value === undefined ? '?' : String(value))

/** The code-verified academic safeguards stored with a completed run. */
export function safeguardChecks(results: CourseEquivalencyDeterministicResults | null): SafeguardCheck[] | null {
  if (!results) return null
  const c = results.constraints
  const tl = c.transfer_limit
  const change = c.study_plan.program_change
  const level = results.academic_level
  return [
    {
      key: 'minimum_grade',
      name: 'Minimum grade',
      tone: tone(c.minimum_grade.meets),
      value: c.minimum_grade.grade ? `Grade ${c.minimum_grade.grade}` : 'Grade not found',
      detail: `At least ${c.minimum_grade.required} is required${results.old_course.grade_source ? ` (from the ${results.old_course.grade_source})` : ''}.`,
    },
    {
      key: 'study_plan',
      name: 'Requested course in the study plan',
      tone: tone(c.study_plan.in_plan),
      value: c.study_plan.program_checked ?? 'Program unknown',
      detail:
        c.study_plan.note ??
        (change?.result ? `Program change ${change.result}${change.new_program_name ? ` (${change.new_program_name})` : ''}.` : 'Checked against the program’s study plan.'),
    },
    {
      key: 'credit_hours',
      name: 'Credit hours',
      tone: tone(c.credit_hours.old_covers_new),
      value: `${n(c.credit_hours.old)} vs ${n(c.credit_hours.new)}`,
      detail: 'The completed course must have at least the credit hours of the requested course.',
    },
    {
      key: 'transfer_limit',
      name: 'Transfer credit limit',
      tone: tone(tl.within_limit),
      value: `${n(tl.total_after)} of ${tl.cap_credit_hours}`,
      detail: `${tl.already_transferred} already transferred${tl.college ? ` · ${tl.college}` : ''}. ${tl.note}`,
    },
    {
      key: 'academic_level',
      name: 'Academic level',
      tone: tone(level.old_at_least_new),
      value: `${level.old_level == null ? '?' : level.old_level * 100}-level vs ${level.new_level == null ? '?' : level.new_level * 100}-level`,
      detail: 'Supporting evidence (not a hard rule).',
    },
  ]
}

export const SIMILARITY_COMPONENTS: { key: keyof CourseEquivalencySimilarity['components_percent']; label: string; weight: number }[] = [
  { key: 'topics', label: 'Topics covered', weight: 50 },
  { key: 'learning_outcomes', label: 'Learning outcomes covered', weight: 25 },
  { key: 'assessment_structure', label: 'Assessment structure', weight: 10 },
  { key: 'credit_hours', label: 'Credit hours', weight: 15 },
]

export function scoreBandLabel(similarity: CourseEquivalencySimilarity): string {
  const t = similarity.thresholds
  switch (similarity.score_band) {
    case 'EQUIVALENT_RANGE':
      return `Equivalent range (at least ${t.equivalent_min}%)`
    case 'REVIEW_RANGE':
      return `Review range (${t.review_min}% to below ${t.equivalent_min}%)`
    case 'BELOW_RANGE':
      return `Below ${t.review_min}%`
    default:
      return 'No score'
  }
}

export function matchSummary(similarity: CourseEquivalencySimilarity | null): string | null {
  const v = similarity?.match_verification
  if (!v) return null
  const confirmed = v.claimed_total - v.dropped_total
  return `${confirmed} of ${v.claimed_total} topic and outcome matches were confirmed in the syllabus text${v.dropped_total ? ` (${v.dropped_total} discarded: quote not found)` : ''}.`
}

export const CHECK_STATUS_TONE: Record<string, CheckTone> = { PASS: 'pass', FAIL: 'fail', 'N/A': 'unknown' }

const TONE_LABELS: Record<string, string> = { formal: 'Formal', concise: 'Concise', supportive: 'Supportive' }

export interface RejectionSuggestionsView {
  status: string
  statusNote: string | null
  verified: string[]
  judged: string[]
  reasons: { tone: string; label: string; text: string }[]
  notes: string[]
}

/** Suggested explanations: only for a completed REJECT that carries them. */
export function rejectionSuggestions(run: CourseEquivalencyRun | null): RejectionSuggestionsView | null {
  if (!run || run.run_status !== 'completed' || run.recommendation !== 'REJECT' || !run.rejection_explanation) return null
  const r = run.rejection_explanation
  const statusNote =
    r.status === 'fallback' || r.status === 'unavailable'
      ? 'The AI wording was unavailable; these reasons were built only from the verified facts.'
      : r.status === 'needs_manual_explanation'
        ? 'No rejection reason could be verified from the evidence; write the explanation yourself.'
        : null
  return {
    status: r.status,
    statusNote,
    verified: r.keywords.filter((k) => k.type === 'verified').map((k) => k.description),
    judged: r.keywords.filter((k) => k.type === 'judged').map((k) => k.description),
    reasons: r.suggested_reasons.map((reason) => ({ tone: reason.tone, label: TONE_LABELS[reason.tone] ?? reason.tone, text: reason.text })),
    notes: r.notes,
  }
}

export function evaluatedFile(run: CourseEquivalencyRun | null, side: SyllabusSide): EvaluatedSyllabus | null {
  return run?.evaluated_syllabi?.find((ref) => ref.side === side) ?? null
}

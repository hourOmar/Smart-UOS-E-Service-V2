// The Course Substitution evaluation state returned by the staff backend
// (GET .../evaluation, POST .../evaluations). Pure functions only (no
// network, no Supabase), so they can be tested with `npm test`.

export type CourseSubstitutionResult = 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'MANUAL_REVIEW'
export type CheckStatus = 'PASS' | 'FAIL' | 'REQUIRES_REVIEW'

/** One of the five eligibility checks, exactly as the agent stored it. */
export interface CourseSubstitutionCheck {
  condition: string
  status: CheckStatus | string
  evidence: string
}

/** The Rejection Explanation Agent's suggestions (stored only after NOT_ELIGIBLE). */
export interface CourseSubstitutionRejection {
  status: 'gemini' | 'fallback' | string
  deterministic_keywords: { keyword: string; label: string; policy_basis: string; plain_reason?: string }[]
  judgment_keywords: string[]
  suggested_reasons: { tone: string; text: string; addresses_keywords?: string[] }[]
  conflict_note: string
  fallback_note?: string | null
  gemini_error?: string | null
}

export interface CourseSubstitutionRun {
  id: number
  run_status: 'running' | 'completed' | 'failed' | 'interrupted'
  trigger: 'first_open' | 'rerun'
  started_at: string | null
  finished_at: string | null
  overall_result: CourseSubstitutionResult | null
  /** YYYY01 (Fall) or YYYY02 (Spring); null in June–July (no Summer term). */
  current_term: number | null
  current_semester: 'Fall' | 'Spring' | null
  checks: CourseSubstitutionCheck[] | null
  rejection: CourseSubstitutionRejection | null
  evidence?: Record<string, unknown> | null
  study_plan_model: string | null
  rejection_model: string | null
  /** Safe for staff: why an AI step fell back (the run still completed). */
  gemini_error: string | null
  agent_version: string | null
  failure_kind: 'data' | 'technical' | 'interrupted' | null
  /** Safe for staff: already shortened by the backend for technical failures. */
  error_message: string | null
}

export interface CourseSubstitutionEvaluationState {
  request_id: string
  request_status: string
  /** No Course_Substitution row: never evaluated, no re-run. */
  details_missing: boolean
  details_missing_message: string | null
  /** Newest completed run. */
  current: CourseSubstitutionRun | null
  /** A newer attempt that is not `current` (failed, interrupted or running). */
  latest_attempt: CourseSubstitutionRun | null
  in_progress: boolean
  run_count: number
  /** Never evaluated, In Progress and details present: a first evaluation may be started. */
  auto_run_eligible: boolean
  /** In Progress, details present and nothing running. */
  can_rerun: boolean
}

/** The POST response: the saved state plus what this call did. */
export interface CourseSubstitutionRunResponse extends CourseSubstitutionEvaluationState {
  started_by_this_call?: boolean
  outcome?: 'started' | 'running' | 'already_evaluated' | 'not_in_progress' | 'details_missing' | string
}

/** The backend path of the saved evaluation state (GET; never runs the agent). */
export function courseSubstitutionEvaluationPath(requestId: string): string {
  return `/api/staff/course-substitution/${encodeURIComponent(requestId)}/evaluation`
}

/** The backend path that starts an evaluation (POST with {rerun}). */
export function courseSubstitutionEvaluationsPath(requestId: string): string {
  return `/api/staff/course-substitution/${encodeURIComponent(requestId)}/evaluations`
}

/** The exact POST body: rerun=false for the first evaluation, true to evaluate again. */
export function evaluationRequestBody(rerun: boolean): string {
  return JSON.stringify({ rerun })
}

/** Whether a first evaluation may be started now (manual: never on opening). */
export function canStartFirstEvaluation(state: CourseSubstitutionEvaluationState | null, running: boolean): boolean {
  return state !== null && state.auto_run_eligible && !state.details_missing && !state.in_progress && !running
}

/** Whether a re-evaluation may be started now. */
export function canStartReevaluation(state: CourseSubstitutionEvaluationState | null, running: boolean): boolean {
  return state !== null && state.can_rerun && !state.details_missing && !state.in_progress && !running
}

export const RESULT_LABELS: Record<CourseSubstitutionResult, string> = {
  ELIGIBLE: 'Eligible',
  NOT_ELIGIBLE: 'Not eligible',
  MANUAL_REVIEW: 'Manual review',
}

export const RUN_STATUS_LABELS: Record<CourseSubstitutionRun['run_status'], string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  interrupted: 'Interrupted',
}

export const ADVISORY_NOTE = 'Advisory only — the final decision belongs to the administrator.'

// ---------------------------------------------------------------------------
// Review page display rules

export type CheckTone = 'pass' | 'fail' | 'review'

export const CHECK_STATUS_LABELS: Record<CheckStatus, string> = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  REQUIRES_REVIEW: 'REQUIRES REVIEW',
}

const CHECK_TONES: Record<CheckStatus, CheckTone> = { PASS: 'pass', FAIL: 'fail', REQUIRES_REVIEW: 'review' }

export interface CheckRow {
  key: string
  condition: string
  status: CheckStatus
  tone: CheckTone
  label: string
  evidence: string
}

/** The stored checks in their stored order (the agent writes five), each with
 *  its own condition and evidence text. An unknown status is shown as
 *  REQUIRES_REVIEW, never as a pass. Null when no checks were stored. */
export function checkRows(run: CourseSubstitutionRun | null | undefined): CheckRow[] | null {
  const checks = run?.checks
  if (!Array.isArray(checks) || checks.length === 0) return null
  return checks.map((check, index) => {
    const raw = typeof check?.status === 'string' ? check.status : ''
    const status: CheckStatus = Object.hasOwn(CHECK_TONES, raw) ? (raw as CheckStatus) : 'REQUIRES_REVIEW'
    return {
      key: `${index}`,
      condition: typeof check?.condition === 'string' && check.condition.trim() ? check.condition.trim() : `Check ${index + 1}`,
      status,
      tone: CHECK_TONES[status],
      label: CHECK_STATUS_LABELS[status],
      evidence: typeof check?.evidence === 'string' && check.evidence.trim() ? check.evidence.trim() : 'No evidence recorded.',
    }
  })
}

export const SUMMER_LIMITATION_MESSAGE =
  'The current term could not be determined: June and July have no supported Summer term. ' +
  'The checks that depend on the term (the original course’s availability and the proposed course’s offering) ' +
  'need manual review, so the result is Manual review unless another check failed.'

/** The Summer limitation note for a completed run without a current term, or null. */
export function summerLimitation(run: CourseSubstitutionRun | null | undefined): string | null {
  if (!run || run.run_status !== 'completed') return null
  return run.current_term == null ? SUMMER_LIMITATION_MESSAGE : null
}

/** "Fall 2026 (202601)", or null without a term. */
export function termLabel(run: CourseSubstitutionRun | null | undefined): string | null {
  if (!run || run.current_term == null) return null
  const year = Math.floor(run.current_term / 100)
  return run.current_semester ? `${run.current_semester} ${year} (${run.current_term})` : String(run.current_term)
}

/** The suggestion tones, in the order shown. */
export const SUGGESTION_TONES: readonly { tone: string; label: string }[] = [
  { tone: 'formal', label: 'Formal' },
  { tone: 'concise', label: 'Concise' },
  { tone: 'supportive', label: 'Supportive' },
]

/** Labels of the judgment keywords (the closed list in the backend's
 *  data/rejection_keywords.json). These are the AI's assessment, never
 *  verified records. */
export const JUDGMENT_REASON_LABELS: Record<string, string> = {
  graduation_timing_not_satisfied: 'Graduation timing does not meet the substitution conditions',
  study_plan_requirement_not_confirmed: 'Study plan requirement could not be confirmed',
  course_offering_information_uncertain: 'Course offering information is uncertain',
}

export interface RejectionSuggestions {
  reasons: { tone: string; label: string; text: string }[]
  /** The verified reasons behind the rejection (failed checks; labels only). */
  policyReasons: string[]
  /** Reasons the AI assessed (judgment keywords; labels only). Not verified facts. */
  assessedReasons: string[]
  conflictNote: string | null
  /** Why there are no (or only template) suggestions; null when the AI succeeded. */
  message: string | null
}

const SUGGESTION_MESSAGES: Record<string, string> = {
  fallback:
    'The AI could not write suggestions, so the ones below are built from the verified checks only. Edit them before use.',
  unavailable: 'No suggested explanation is available. Write the explanation yourself.',
}

/** The suggested explanations of a NOT_ELIGIBLE run (formal, concise,
 *  supportive, in that order), or null for any other run. */
export function rejectionSuggestions(run: CourseSubstitutionRun | null | undefined): RejectionSuggestions | null {
  if (!run || run.overall_result !== 'NOT_ELIGIBLE') return null
  const rejection = run.rejection
  if (!rejection) {
    return { reasons: [], policyReasons: [], assessedReasons: [], conflictNote: null, message: SUGGESTION_MESSAGES.unavailable }
  }
  const stored = Array.isArray(rejection.suggested_reasons) ? rejection.suggested_reasons : []
  const reasons = SUGGESTION_TONES.flatMap(({ tone, label }) => {
    const found = stored.find((r) => r?.tone === tone && typeof r.text === 'string' && r.text.trim() !== '')
    return found ? [{ tone, label, text: found.text.trim() }] : []
  })
  const policyReasons = (Array.isArray(rejection.deterministic_keywords) ? rejection.deterministic_keywords : [])
    .map((k) => k?.label)
    .filter((label): label is string => typeof label === 'string' && label !== '')
  // Only known judgment keywords are shown (by label, never the raw id), once each.
  const assessedReasons = [...new Set(
    (Array.isArray(rejection.judgment_keywords) ? rejection.judgment_keywords : [])
      .map((id) => (typeof id === 'string' ? JUDGMENT_REASON_LABELS[id] : undefined))
      .filter((label): label is string => Boolean(label) && !policyReasons.includes(label as string)),
  )]
  const status = reasons.length === 0 ? 'unavailable' : rejection.status === 'gemini' ? 'ok' : 'fallback'
  return {
    reasons,
    policyReasons,
    assessedReasons,
    conflictNote: rejection.conflict_note?.trim() || null,
    message: status === 'ok' ? null : SUGGESTION_MESSAGES[status],
  }
}

export interface SavedEvaluationStatus {
  tone: 'missing' | 'running' | 'evaluated' | 'failed' | 'none'
  label: string
  detail: string
}

/** One line summarising what is saved. Never implies that opening the page
 *  starts an evaluation. */
export function savedEvaluationStatus(state: CourseSubstitutionEvaluationState): SavedEvaluationStatus {
  if (state.details_missing) {
    return {
      tone: 'missing',
      label: 'Details missing',
      detail: state.details_missing_message ?? 'This request has no Course Substitution details, so it cannot be evaluated.',
    }
  }
  if (state.in_progress) {
    return { tone: 'running', label: 'Evaluation running', detail: 'An evaluation is running for this request.' }
  }
  const latest = state.latest_attempt
  const latestFailed = latest?.run_status === 'failed' || latest?.run_status === 'interrupted'
  if (state.current) {
    const result = state.current.overall_result
    return {
      tone: 'evaluated',
      label: result ? `Evaluated · ${RESULT_LABELS[result]}` : 'Evaluated',
      detail: latestFailed
        ? 'A later attempt failed; the result shown is the last successful evaluation.'
        : 'The advisory result is saved. The decision stays with staff.',
    }
  }
  if (latestFailed && latest) {
    return {
      tone: 'failed',
      label: latest.run_status === 'interrupted' ? 'Last attempt interrupted' : 'Last attempt failed',
      detail: latest.error_message ?? 'The evaluation did not finish.',
    }
  }
  return {
    tone: 'none',
    label: 'Not evaluated yet',
    detail: state.auto_run_eligible
      ? 'Eligible for a first evaluation. Opening this page does not start one.'
      : 'No evaluation is saved, and none can start while the request is not In Progress.',
  }
}

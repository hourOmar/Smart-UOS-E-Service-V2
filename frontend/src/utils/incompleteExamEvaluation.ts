// The Incomplete Exam evaluation state returned by the staff backend
// (GET .../evaluation, POST .../evaluations). Pure functions only (no
// network, no Supabase), so they can be tested with `npm test`.

export type IncompleteExamRecommendation = 'APPROVE' | 'REJECT' | 'MANUAL_REVIEW'

/** The verified (non-AI) checks stored with a completed run. */
export interface IncompleteExamDeterministicResults {
  enrollment: { found: boolean; grade: string | null }
  submission_window: {
    satisfied: boolean
    missed_exam_date: string
    request_date: string
    working_days_elapsed: number
    limit_working_days: number
    holiday_calendar_checked: boolean
  }
  proof: {
    required: boolean
    provided: boolean | null
    file_attached: boolean
    file_count: number
    file_source: string | null
  }
  exam_type: { value: string | null; excluded: boolean | null; excluded_values_confirmed: boolean }
}

/** Agent 5's explanation per check (after the backend's output safeguard). */
export interface IncompleteExamCheckExplanations {
  enrollment: string
  submission_window: string
  proof: string
  reason_validity: string
  exam_type: string
}

/** One stored proof reference (never the file contents). */
export interface IncompleteExamProofReference {
  path: string
  outcome: 'attached' | 'skipped_unsupported_type' | 'skipped_too_large' | 'skipped_content_mismatch' | string
  mime_type?: string
  bytes?: number
  sha256?: string
}

/** Agent 6's suggestions (stored only after a REJECT). */
export interface IncompleteExamRejectionExplanation {
  status: 'ok' | 'fallback' | 'unavailable' | 'needs_manual_explanation' | string
  deterministic_keywords: { keyword: string; label: string; policy_basis: string; plain_reason?: string }[]
  judgment_keywords: string[]
  suggested_reasons: { tone: string; text: string; addresses_keywords: string[] }[]
  conflict_note: string
}

export interface IncompleteExamRun {
  id: number
  run_status: 'running' | 'completed' | 'failed' | 'interrupted'
  trigger: 'first_open' | 'rerun'
  started_at: string | null
  finished_at: string | null
  recommendation: IncompleteExamRecommendation | null
  reasoning?: string | null
  check_explanations?: IncompleteExamCheckExplanations | null
  deterministic_results?: IncompleteExamDeterministicResults | null
  recommendation_conflict: boolean
  proof_files?: IncompleteExamProofReference[] | null
  rejection_explanation?: IncompleteExamRejectionExplanation | null
  assessment_model: string | null
  rejection_model: string | null
  agent_version: string | null
  failure_kind: 'data' | 'technical' | 'interrupted' | null
  /** Safe for staff: already shortened by the backend for technical failures. */
  error_message: string | null
}

export interface IncompleteExamEvaluationState {
  request_id: string
  request_status: string
  /** No Incomplete_Exam row: never evaluated, no re-run. */
  details_missing: boolean
  details_missing_message: string | null
  /** Newest completed run. */
  current: IncompleteExamRun | null
  /** A newer attempt that is not `current` (failed, interrupted or running). */
  latest_attempt: IncompleteExamRun | null
  in_progress: boolean
  run_count: number
  /** Never evaluated, In Progress and details present: a first evaluation may be started. */
  auto_run_eligible: boolean
  /** In Progress, details present and nothing running. */
  can_rerun: boolean
}

/** The POST response: the saved state plus what this call did. */
export interface IncompleteExamRunResponse extends IncompleteExamEvaluationState {
  started_by_this_call?: boolean
  outcome?: 'started' | 'running' | 'already_evaluated' | 'not_in_progress' | 'details_missing' | string
}

/** The backend path of the saved evaluation state (GET; never runs the agents). */
export function incompleteExamEvaluationPath(requestId: string): string {
  return `/api/staff/incomplete-exam/${encodeURIComponent(requestId)}/evaluation`
}

/** The backend path that starts an evaluation (POST with {rerun}). */
export function incompleteExamEvaluationsPath(requestId: string): string {
  return `/api/staff/incomplete-exam/${encodeURIComponent(requestId)}/evaluations`
}

/** The exact POST body: rerun=false for the first evaluation, true to evaluate again. */
export function evaluationRequestBody(rerun: boolean): string {
  return JSON.stringify({ rerun })
}

/** Whether a first evaluation may be started now (manual: never on opening). */
export function canStartFirstEvaluation(state: IncompleteExamEvaluationState | null, running: boolean): boolean {
  return state !== null && state.auto_run_eligible && !state.details_missing && !state.in_progress && !running
}

/** Whether a re-evaluation may be started now. */
export function canStartReevaluation(state: IncompleteExamEvaluationState | null, running: boolean): boolean {
  return state !== null && state.can_rerun && !state.details_missing && !state.in_progress && !running
}

export const RECOMMENDATION_LABELS: Record<IncompleteExamRecommendation, string> = {
  APPROVE: 'Approve',
  REJECT: 'Reject',
  MANUAL_REVIEW: 'Manual review',
}

export const RUN_STATUS_LABELS: Record<IncompleteExamRun['run_status'], string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  interrupted: 'Interrupted',
}

export function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No'
}

// ---------------------------------------------------------------------------
// Review page display rules (Agent 5's checks, Agent 6's suggestions)

export type CheckTone = 'pass' | 'fail' | 'unknown'
export type CheckKey = keyof IncompleteExamCheckExplanations

/** Agent 5's five check explanations, in the order shown. */
export const CHECK_EXPLANATION_LABELS: readonly { key: CheckKey; label: string }[] = [
  { key: 'enrollment', label: 'Course enrolment' },
  { key: 'submission_window', label: 'Submission window' },
  { key: 'proof', label: 'Proof document' },
  { key: 'reason_validity', label: 'Reason validity' },
  { key: 'exam_type', label: 'Exam type' },
]

export interface VerifiedCheck {
  key: CheckKey
  name: string
  tone: CheckTone
  value: string
  detail: string
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** The verified (database, non-AI) checks of a completed run, or null when
 *  none were stored. Reason validity is a judgment, so it has no verified check. */
export function verifiedChecks(results: IncompleteExamDeterministicResults | null | undefined): VerifiedCheck[] | null {
  if (!results) return null
  const enrollment = results.enrollment
  const window = results.submission_window
  const proof = results.proof
  const exam = results.exam_type
  const elapsed = typeof window?.working_days_elapsed === 'number' ? window.working_days_elapsed : null
  const limit = typeof window?.limit_working_days === 'number' ? window.limit_working_days : null
  const files = typeof proof?.file_count === 'number' ? proof.file_count : 0

  return [
    {
      key: 'enrollment',
      name: 'Course enrolment',
      tone: enrollment?.found === true ? 'pass' : enrollment?.found === false ? 'fail' : 'unknown',
      value: enrollment?.found === true ? 'Enrolled' : enrollment?.found === false ? 'Not enrolled' : 'Not recorded',
      detail:
        enrollment?.found === true
          ? enrollment.grade
            ? `Enrolled in the course; grade on record: ${enrollment.grade}.`
            : 'Enrolled in the course for this term.'
          : enrollment?.found === false
            ? 'No enrolment in this course and term was found.'
            : 'No enrolment result was recorded.',
    },
    {
      key: 'submission_window',
      name: 'Submission window',
      tone: window?.satisfied === true ? 'pass' : window?.satisfied === false ? 'fail' : 'unknown',
      value: elapsed !== null && limit !== null ? `${elapsed} / ${plural(limit, 'working day')}` : 'Not recorded',
      detail:
        (window?.satisfied === true
          ? 'Submitted within the allowed working days after the missed exam.'
          : window?.satisfied === false
            ? 'Submitted after the allowed working days.'
            : 'No submission-window result was recorded.') +
        (window && window.holiday_calendar_checked === false ? ' Public holidays were not taken into account.' : ''),
    },
    {
      key: 'proof',
      name: 'Proof document',
      tone: proof?.file_attached === true ? 'pass' : proof?.file_attached === false && proof.required ? 'fail' : 'unknown',
      value: proof?.file_attached === true ? `${plural(files, 'file')} read` : 'None read',
      detail:
        proof?.file_attached === true
          ? 'A proof document was attached for the agent to read.'
          : proof?.required
            ? 'Proof is required, and no readable proof document was attached.'
            : 'No readable proof document was attached.',
    },
    {
      key: 'exam_type',
      name: 'Exam type',
      tone: exam?.excluded === true ? 'fail' : exam?.excluded === false ? 'pass' : 'unknown',
      value: exam?.value ?? 'Not recorded',
      detail:
        (exam?.excluded === true
          ? 'This exam type is not eligible for an incomplete grade.'
          : exam?.excluded === false
            ? 'This exam type is eligible.'
            : 'Whether this exam type is eligible was not recorded.') +
        (exam && exam.excluded_values_confirmed === false ? ' The list of excluded exam types is not confirmed.' : ''),
    },
  ]
}

export const SUGGESTION_TONE_LABELS: Record<string, string> = {
  formal: 'Formal',
  concise: 'Concise',
  supportive: 'Supportive',
}

/** Labels of Agent 6's judgment keywords (the closed list in the backend's
 *  knowledge_base/rejection_keywords.json). These are the AI's assessment of
 *  the documents and explanation, never verified records. */
export const JUDGMENT_REASON_LABELS: Record<string, string> = {
  invalid_reason_schedule_misread: 'Misreading the exam schedule',
  invalid_reason_personal_travel: 'Personal or discretionary travel',
  invalid_reason_job_obligation: 'Standard job obligations',
  proof_not_acceptable_category: 'Proof not in an accepted category',
  proof_inconsistent_or_unverifiable: 'Proof inconsistent or could not be accepted',
}

export interface RejectionSuggestions {
  reasons: { tone: string; label: string; text: string }[]
  /** The verified policy reasons behind the rejection (deterministic checks; labels only). */
  policyReasons: string[]
  /** Reasons the AI assessed (judgment keywords; labels only). Not verified facts. */
  assessedReasons: string[]
  /** Agent 6's note when its suggestions and Agent 5's recommendation disagree. */
  conflictNote: string | null
  /** Why there are no (or only template) suggestions; null when Agent 6 succeeded. */
  message: string | null
}

const SUGGESTION_MESSAGES: Record<string, string> = {
  fallback:
    'The AI could not write suggestions, so the one below is built from the verified checks only. Edit it before use.',
  needs_manual_explanation: 'No AI suggestion passed the safety checks. Write the explanation yourself.',
  unavailable: 'No suggested explanation is available. Write the explanation yourself.',
}

/** Agent 6's suggested explanations of a REJECT run, or null for any other run. */
export function rejectionSuggestions(run: IncompleteExamRun | null | undefined): RejectionSuggestions | null {
  if (!run || run.recommendation !== 'REJECT') return null
  const explanation = run.rejection_explanation
  if (!explanation) {
    return { reasons: [], policyReasons: [], assessedReasons: [], conflictNote: null, message: SUGGESTION_MESSAGES.unavailable }
  }
  const reasons = (explanation.suggested_reasons ?? [])
    .filter((r) => typeof r?.text === 'string' && r.text.trim() !== '')
    .map((r) => ({ tone: r.tone, label: SUGGESTION_TONE_LABELS[r.tone] ?? 'Suggested', text: r.text.trim() }))
  const status = explanation.status === 'ok' && reasons.length === 0 ? 'unavailable' : explanation.status
  const policyReasons = (explanation.deterministic_keywords ?? []).map((k) => k.label).filter(Boolean)
  // Only known judgment keywords are shown (by label, never the raw id), once each.
  const assessedReasons = [...new Set(
    (Array.isArray(explanation.judgment_keywords) ? explanation.judgment_keywords : [])
      .map((id) => (typeof id === 'string' ? JUDGMENT_REASON_LABELS[id] : undefined))
      .filter((label): label is string => Boolean(label) && !policyReasons.includes(label as string)),
  )]
  return {
    reasons,
    policyReasons,
    assessedReasons,
    conflictNote: explanation.conflict_note?.trim() || null,
    message: status === 'ok' ? null : (SUGGESTION_MESSAGES[status] ?? SUGGESTION_MESSAGES.unavailable),
  }
}

export const PROOF_OUTCOME_LABELS: Record<string, string> = {
  attached: 'Read by the agent',
  skipped_unsupported_type: 'Not read by the agent: unsupported type',
  skipped_too_large: 'Not read by the agent: too large',
  skipped_content_mismatch: 'Not read by the agent: contents did not match the type',
}

/** How the newest completed run used each stored proof path. */
export function proofOutcomes(run: IncompleteExamRun | null | undefined): Map<string, string> {
  const outcomes = new Map<string, string>()
  for (const ref of run?.proof_files ?? []) {
    if (ref && typeof ref.path === 'string') {
      outcomes.set(ref.path, PROOF_OUTCOME_LABELS[ref.outcome] ?? 'Not read by the agent')
    }
  }
  return outcomes
}

export interface SavedEvaluationStatus {
  tone: 'missing' | 'running' | 'evaluated' | 'failed' | 'none'
  label: string
  detail: string
}

/** One line summarising what is saved. Never implies that opening the page
 *  starts an evaluation. */
export function savedEvaluationStatus(state: IncompleteExamEvaluationState): SavedEvaluationStatus {
  if (state.details_missing) {
    return {
      tone: 'missing',
      label: 'Details missing',
      detail: state.details_missing_message ?? 'This request has no Incomplete Exam details, so it cannot be evaluated.',
    }
  }
  if (state.in_progress) {
    return { tone: 'running', label: 'Evaluation running', detail: 'An evaluation is running for this request.' }
  }
  const latest = state.latest_attempt
  const latestFailed = latest?.run_status === 'failed' || latest?.run_status === 'interrupted'
  if (state.current) {
    const recommendation = state.current.recommendation
    const label = recommendation ? `Evaluated · ${RECOMMENDATION_LABELS[recommendation]}` : 'Evaluated'
    return {
      tone: 'evaluated',
      label,
      detail: latestFailed
        ? 'A later attempt failed; the result shown is the last successful evaluation.'
        : 'The advisory recommendation is saved. The decision stays with staff.',
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

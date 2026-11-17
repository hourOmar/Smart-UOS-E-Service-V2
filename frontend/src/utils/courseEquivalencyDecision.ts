// Rules for the administrator's final Course Equivalency decision, kept free of network
// imports so they can be tested on their own (tests/courseEquivalencyDecision.test.ts). The
// database function decide_course_equivalency_request enforces the same rules
// (database/maintenance/course-equivalency-decision/01_install.sql); these only give the
// administrator immediate feedback. The explanation rules are the shared ones
// (programChangeDecision.ts: 1-2000 characters, counted as the database does).
//
// DECISION ONLY: an approval records the administrative decision and sets the request to
// Completed. It does not add the course to the transcript, award credit hours, or change
// the student's CGPA, completed hours or program (academic-record integration is a later
// phase). ACADEMIC_RECORD_LIMITATION says so wherever an approval is offered or shown.

import type {
  CourseEquivalencyEvaluationState,
  CourseEquivalencyRecommendation,
  CourseEquivalencyRun,
} from './courseEquivalencyEvaluation.ts'
import type { DecisionChoice } from './programChangeDecision.ts'

export { MAX_EXPLANATION, explanationError, explanationLength } from './programChangeDecision.ts'
export type { DecisionChoice } from './programChangeDecision.ts'

/** The id of the review page's explanation field. */
export const EXPLANATION_FIELD_ID = 'cer-note'

/** The Decision_Type values written by decide_course_equivalency_request. */
export const COURSE_EQUIVALENCY_DECISION_TYPES: Record<DecisionChoice, string> = {
  approve: 'Course Equivalency Approved',
  reject: 'Course Equivalency Rejected',
}

/** Shown beside the decision form and on every recorded approval. */
export const ACADEMIC_RECORD_LIMITATION =
  'Approval records the administrative decision only. It does not add the course to the student’s transcript, award credit hours, or change the student’s CGPA, completed hours or program. Academic-record integration is not available yet.'

/** Refusals raised by decide_course_equivalency_request, in staff-facing words. */
export const COURSE_EQUIVALENCY_DECISION_MESSAGES: Record<string, string> = {
  not_staff: 'Only staff members linked in Authorized_Staff can decide requests.',
  invalid_decision: 'Choose Approve or Reject.',
  explanation_required: 'Enter an explanation for the student.',
  explanation_too_long: 'The explanation can be at most 2,000 characters.',
  evaluation_required: 'There is no agent evaluation to decide on. Run the evaluation first; nothing was saved.',
  request_not_found: 'This request no longer exists.',
  not_course_equivalency: 'Only Course Equivalency requests can be decided here.',
  course_equivalency_details_missing:
    'This request has no Course Equivalency details (old and new course), so it cannot be decided.',
  already_decided: 'This request has already been decided. The saved decision is shown below.',
  evaluation_running: 'An agent evaluation is running. Wait for it to finish, then decide; nothing was saved.',
  evaluation_missing:
    'A completed agent evaluation is required before the final decision. Run the evaluation first; nothing was saved.',
  evaluation_failed:
    'The agent evaluation failed, so there is no result to decide on. Re-evaluate first; nothing was saved.',
  evaluation_outdated:
    'A syllabus was replaced after the last evaluation. Re-evaluate the current syllabi first; nothing was saved.',
  evaluation_changed:
    'A newer agent evaluation was saved while you were deciding. Review it, then decide again; nothing was saved.',
  override_confirmation_required:
    'Your decision differs from the agent’s recommendation. Confirm the override to continue; nothing was saved.',
  signed_out: 'Your session has ended. Sign in again; nothing was saved.',
}

export const UNKNOWN_DECISION_MESSAGE =
  'The decision could not be saved. The page has been refreshed to show the current state.'

export const CONNECTION_DECISION_MESSAGE =
  'The connection failed before the result was known. The page has been refreshed to show the current state.'

/** The refusal code for an error returned by the database call. */
export function courseEquivalencyDecisionErrorCode(error: { message?: string; code?: string } | null | undefined): string {
  const message = error?.message ?? ''
  if (Object.hasOwn(COURSE_EQUIVALENCY_DECISION_MESSAGES, message)) return message
  // Expired or missing session: the API rejects the token, or the call arrives without a
  // signed-in user, who may not execute the function.
  if (error?.code === 'PGRST301' || /jwt/i.test(message) || message.startsWith('permission denied')) {
    return 'signed_out'
  }
  return 'unknown'
}

export function courseEquivalencyDecisionErrorMessage(code: string): string {
  return Object.hasOwn(COURSE_EQUIVALENCY_DECISION_MESSAGES, code)
    ? COURSE_EQUIVALENCY_DECISION_MESSAGES[code]
    : UNKNOWN_DECISION_MESSAGE
}

/** A decision against a definite recommendation (approve against REJECT, reject against
 *  APPROVE), as the database defines it. MANUAL_REVIEW leaves the outcome to the
 *  administrator, so neither decision overrides it. */
export function isOverride(choice: DecisionChoice | null, recommendation: CourseEquivalencyRecommendation | null): boolean {
  if (!choice || !recommendation) return false
  return (choice === 'approve' && recommendation === 'REJECT') || (choice === 'reject' && recommendation === 'APPROVE')
}

export type DecisionBlocker = 'loading' | 'unavailable' | 'running' | 'missing' | 'failed' | 'outdated'

export type DecisionReadiness =
  | { ready: true; run: CourseEquivalencyRun; recommendation: CourseEquivalencyRecommendation }
  | { ready: false; blocker: DecisionBlocker; message: string | null }

export const READINESS_MESSAGES: Record<DecisionBlocker, string | null> = {
  loading: null,
  unavailable:
    'The agent evaluation could not be loaded, so the final decision cannot be recorded yet. Reload the page to try again.',
  running: 'An agent evaluation is running. The final decision can be recorded once it has finished.',
  missing:
    'A completed agent evaluation is required before the final decision. Run the evaluation above first.',
  failed:
    'The latest agent evaluation failed or was interrupted. Re-evaluate above and wait for a successful result before deciding (an older result cannot be used).',
  outdated:
    'A syllabus was replaced after the last evaluation, so its result no longer reflects the current files. Re-evaluate above before deciding.',
}

const blocked = (blocker: DecisionBlocker): DecisionReadiness => ({ ready: false, blocker, message: READINESS_MESSAGES[blocker] })

/** Whether a final decision can be recorded now, by the same rules as the database: no run
 *  in progress, the NEWEST run is a completed one (a failed or interrupted latest
 *  re-evaluation blocks the decision even when an older completed evaluation exists), and it
 *  evaluated the current syllabi. Its id is sent with the decision.
 *  The API's `latest_attempt` is the newest run whenever that is not `current` (the newest
 *  completed run), so any `latest_attempt` blocks. */
export function decisionReadiness(evaluation: {
  status: 'loading' | 'ready' | 'error'
  data: CourseEquivalencyEvaluationState | null
  running: boolean
}): DecisionReadiness {
  const { status, data, running } = evaluation
  if (!data) return blocked(status === 'error' ? 'unavailable' : 'loading')
  if (running || data.in_progress) return blocked('running')
  const latest = data.latest_attempt
  if (latest) {
    if (latest.run_status === 'running') return blocked('running')
    return blocked(latest.run_status === 'failed' || latest.run_status === 'interrupted' ? 'failed' : 'missing')
  }
  const current = data.current
  if (!current || current.run_status !== 'completed' || !current.recommendation) return blocked('missing')
  if (current.outdated) return blocked('outdated')
  return { ready: true, run: current, recommendation: current.recommendation }
}

/** The saved decision as staff see it: the Decision row only, as for the other request
 *  types. */
export interface CourseEquivalencyDecisionRecord {
  id: number
  choice: DecisionChoice
  explanation: string
  staffId: number | null
  /** Only readable for the signed-in staff member's own decisions. */
  staffName: string | null
  /** ISO timestamp (UTC). */
  date: string | null
}

type Row = Record<string, unknown> | null | undefined

function utc(value: unknown): string | null {
  const raw = value == null ? '' : String(value).trim()
  if (!raw) return null
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`
}

/** Builds the staff view of a Decision row. Returns null unless the row is a Course
 *  Equivalency decision. */
export function toCourseEquivalencyDecisionRecord(decision: Row): CourseEquivalencyDecisionRecord | null {
  if (!decision) return null
  const type = String(decision.Decision_Type ?? '')
  const choice: DecisionChoice | null =
    type === COURSE_EQUIVALENCY_DECISION_TYPES.approve ? 'approve' : type === COURSE_EQUIVALENCY_DECISION_TYPES.reject ? 'reject' : null
  if (!choice) return null
  const staff = decision.Authorized_Staff as Row | Row[]
  const decider = Array.isArray(staff) ? (staff[0] ?? null) : (staff ?? null)
  return {
    id: Number(decision.Decision_ID),
    choice,
    explanation: String(decision.Decision_Comment ?? ''),
    staffId: decision.Staff_ID == null ? null : Number(decision.Staff_ID),
    staffName: decider?.Staff_Name ? String(decider.Staff_Name) : null,
    date: utc(decision.Decision_Date),
  }
}

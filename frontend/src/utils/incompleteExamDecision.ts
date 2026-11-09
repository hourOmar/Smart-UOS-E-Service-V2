// Rules for the administrator's final Incomplete Exam decision, kept free of
// network imports so they can be tested on their own. The database function
// decide_incomplete_exam_request enforces the same rules; these only give the
// administrator immediate feedback. The explanation rules are the shared ones
// (programChangeDecision.ts: 1-2000 characters, counted as the database does).

import type { IncompleteExamRecommendation } from './incompleteExamEvaluation.ts'
import type { DecisionChoice } from './programChangeDecision.ts'

export { MAX_EXPLANATION, explanationError, explanationLength, rerunAllowed } from './programChangeDecision.ts'
export type { DecisionChoice } from './programChangeDecision.ts'

/** The id of the review page's explanation field ("Use this reason" focuses it). */
export const EXPLANATION_FIELD_ID = 'ier-note'

/** The Decision_Type values written by decide_incomplete_exam_request. */
export const INCOMPLETE_EXAM_DECISION_TYPES: Record<DecisionChoice, string> = {
  approve: 'Incomplete Exam Approved',
  reject: 'Incomplete Exam Rejected',
}

/** Refusals raised by decide_incomplete_exam_request, in staff-facing words. */
export const INCOMPLETE_EXAM_DECISION_MESSAGES: Record<string, string> = {
  not_staff: 'Only staff members linked in Authorized_Staff can decide requests.',
  invalid_decision: 'Choose Approve or Reject.',
  explanation_required: 'Enter an explanation for the student.',
  explanation_too_long: 'The explanation can be at most 2,000 characters.',
  request_not_found: 'This request no longer exists.',
  not_incomplete_exam: 'Only Incomplete Exam requests can be decided here.',
  incomplete_exam_details_missing:
    'This request has no Incomplete Exam details (course, exam and proof), so it cannot be decided.',
  already_decided: 'This request has already been decided. The saved decision is shown below.',
  signed_out: 'Your session has ended. Sign in again; nothing was saved.',
}

export const UNKNOWN_DECISION_MESSAGE =
  'The decision could not be saved. The page has been refreshed to show the current state.'

export const CONNECTION_DECISION_MESSAGE =
  'The connection failed before the result was known. The page has been refreshed to show the current state.'

/** The refusal code for an error returned by the database call. */
export function incompleteExamDecisionErrorCode(error: { message?: string; code?: string } | null | undefined): string {
  const message = error?.message ?? ''
  if (Object.hasOwn(INCOMPLETE_EXAM_DECISION_MESSAGES, message)) return message
  // Expired or missing session: the API rejects the token, or the call
  // arrives without a signed-in user, who may not execute the function.
  if (error?.code === 'PGRST301' || /jwt/i.test(message) || message.startsWith('permission denied')) {
    return 'signed_out'
  }
  return 'unknown'
}

export function incompleteExamDecisionErrorMessage(code: string): string {
  return Object.hasOwn(INCOMPLETE_EXAM_DECISION_MESSAGES, code)
    ? INCOMPLETE_EXAM_DECISION_MESSAGES[code]
    : UNKNOWN_DECISION_MESSAGE
}

/** The administrator's choice differs from the advisory recommendation
 *  (MANUAL_REVIEW never matches a choice). */
export function differsFromRecommendation(
  choice: DecisionChoice | null,
  recommendation: IncompleteExamRecommendation | null,
): boolean {
  if (!choice || !recommendation) return false
  if (recommendation === 'MANUAL_REVIEW') return true
  return (choice === 'approve') !== (recommendation === 'APPROVE')
}

export interface IncompleteExamEvaluationSummary {
  /** The saved evaluation state is still loading (no warning yet). */
  loading: boolean
  /** A completed evaluation exists. */
  hasCompleted: boolean
  /** The newest attempt failed or was interrupted. */
  latestFailed: boolean
  /** An evaluation is running now. */
  running: boolean
  /** The evaluation state could not be loaded. */
  unavailable: boolean
}

/** A warning shown beside the decision form when there is no usable AI
 *  evaluation. It never blocks the decision: the agents are advisory. */
export function evaluationWarning(summary: IncompleteExamEvaluationSummary): string | null {
  if (summary.loading) return null
  if (summary.unavailable) {
    return 'The AI evaluation could not be loaded. You can still decide; review the request and proof documents yourself.'
  }
  if (summary.running) {
    return 'An AI evaluation is still running. You can wait for it, or decide now; it is advisory only.'
  }
  if (!summary.hasCompleted) {
    return summary.latestFailed
      ? 'The AI evaluation failed, so there is no recommendation. You can still decide; review the request and proof documents yourself.'
      : 'There is no completed AI evaluation for this request. You can still decide; review the request and proof documents yourself.'
  }
  return null
}

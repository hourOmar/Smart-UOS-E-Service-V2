// Rules for the administrator's final Program Change decision, kept free of
// imports so they can be tested on their own (tests/programChangeDecision.test.ts).
// The database function decide_program_change_request enforces the same rules;
// these only give the administrator immediate feedback.

export type DecisionChoice = 'approve' | 'reject'

export const MAX_EXPLANATION = 2000

/** Characters as the database counts them (code points, after trimming). */
export function explanationLength(value: string) {
  return [...value.trim()].length
}

/** Why an explanation cannot be submitted, or null. `attempted`: the
 *  administrator has tried to continue, so a missing explanation is shown. */
export function explanationError(value: string, attempted: boolean): string | null {
  const length = explanationLength(value)
  if (length === 0) return attempted ? 'Enter an explanation for the student.' : null
  if (length > MAX_EXPLANATION) {
    return `The explanation can be at most ${MAX_EXPLANATION.toLocaleString('en-US')} characters.`
  }
  return null
}

/** Refusals raised by decide_program_change_request, in staff-facing words. */
export const DECISION_MESSAGES: Record<string, string> = {
  not_staff: 'Only staff members linked in Authorized_Staff can decide requests.',
  invalid_decision: 'Choose Approve or Reject.',
  explanation_required: 'Enter an explanation for the student.',
  explanation_too_long: `The explanation can be at most ${MAX_EXPLANATION.toLocaleString('en-US')} characters.`,
  request_not_found: 'This request no longer exists.',
  not_program_change: 'Only Program Change requests can be decided here.',
  program_change_details_missing:
    'This request has no Program Change details (programs and reason), so it cannot be decided.',
  already_decided: 'This request has already been decided. The saved decision is shown below.',
  signed_out: 'Your session has ended. Sign in again; nothing was saved.',
}

export const UNKNOWN_DECISION_MESSAGE =
  'The decision could not be saved. The page has been refreshed to show the current state.'

export const CONNECTION_DECISION_MESSAGE =
  'The connection failed before the result was known. The page has been refreshed to show the current state.'

/** The refusal code for an error returned by the database call. */
export function decisionErrorCode(error: { message?: string; code?: string } | null | undefined): string {
  const message = error?.message ?? ''
  if (Object.hasOwn(DECISION_MESSAGES, message)) return message
  // Expired or missing session: the API rejects the token, or the call
  // arrives without a signed-in user, who may not execute the function.
  if (error?.code === 'PGRST301' || /jwt/i.test(message) || message.startsWith('permission denied')) {
    return 'signed_out'
  }
  return 'unknown'
}

export function decisionErrorMessage(code: string) {
  return Object.hasOwn(DECISION_MESSAGES, code) ? DECISION_MESSAGES[code] : UNKNOWN_DECISION_MESSAGE
}

export type AgentRecommendation = 'APPROVE' | 'REJECT' | 'REQUIRES_REVIEW'

/** The administrator's choice differs from the agent's advisory
 *  recommendation (REQUIRES_REVIEW never matches a choice). */
export function differsFromRecommendation(choice: DecisionChoice | null, recommendation: AgentRecommendation | null) {
  if (!choice || !recommendation) return false
  if (recommendation === 'REQUIRES_REVIEW') return true
  return (choice === 'approve') !== (recommendation === 'APPROVE')
}

export interface EvaluationSummary {
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

/** A warning shown beside the decision form when there is no usable agent
 *  evaluation. It never blocks the decision: the agent is advisory. */
export function evaluationWarning(summary: EvaluationSummary): string | null {
  if (summary.loading) return null
  if (summary.unavailable) {
    return 'The AI evaluation could not be loaded. You can still decide; review the transcript yourself.'
  }
  if (summary.running) {
    return 'An AI evaluation is still running. You can wait for it, or decide now; it is advisory only.'
  }
  if (!summary.hasCompleted) {
    return summary.latestFailed
      ? 'The AI evaluation failed, so there is no recommendation. You can still decide; review the transcript yourself.'
      : 'There is no completed AI evaluation for this request. You can still decide; review the transcript yourself.'
  }
  return null
}

/** Whether a re-run may be offered: only while the request is In Progress,
 *  the API allows it, and nothing is running. */
export function rerunAllowed(requestStatus: string | null | undefined, apiCanRerun: boolean, active: boolean) {
  return requestStatus === 'In Progress' && apiCanRerun && !active
}

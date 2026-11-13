// The signed-in student's view of the decision on their own decided Course
// Substitution request, from get_my_course_substitution_decision. Pure (no
// network), so it can be tested with `npm test`.
//
// A decision is accepted ONLY when the function reports a matching
// administrative Decision record (has_decision_record = true). A request
// finalized without one has no decision view: no outcome is ever inferred
// from the request status.

import { text, utc } from './courseSubstitutionRecord.ts'

export interface CourseSubstitutionDecisionView {
  /** From the administrator's saved decision only. */
  decision: 'approve' | 'reject'
  /** Always true: a view exists only for a matching decision record. */
  hasDecisionRecord: true
  /** The administrator's explanation (approvals and rejections alike). */
  explanation: string | null
  /** ISO timestamp (UTC) of the decision. */
  decidedAt: string | null
}

export function toCourseSubstitutionDecisionView(data: unknown): CourseSubstitutionDecisionView | null {
  const body = data as {
    decision?: string | null
    has_decision_record?: boolean
    explanation?: string | null
    decided_at?: string | null
  } | null
  if (!body || typeof body !== 'object' || body.has_decision_record !== true) return null
  if (body.decision !== 'approve' && body.decision !== 'reject') return null
  return {
    decision: body.decision,
    hasDecisionRecord: true,
    explanation: text(body.explanation),
    decidedAt: utc(body.decided_at),
  }
}

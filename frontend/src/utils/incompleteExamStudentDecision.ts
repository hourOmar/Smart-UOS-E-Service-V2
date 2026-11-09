// The signed-in student's view of the decision on their own decided
// Incomplete Exam request, from get_my_incomplete_exam_decision. Pure (no
// network), so it can be tested with `npm test`.
//
// A decision is accepted ONLY when the function reports a matching
// administrative Decision record (has_decision_record = true). A request
// finalized without one has no decision view: no outcome is ever inferred
// from the request status, whichever version of the database function is
// installed (07_install_decision_record_only.sql returns decision = null;
// the earlier 04 body inferred it from the status).

import { text, utc } from './incompleteExamRecord.ts'

export interface IncompleteExamDecisionView {
  /** From the administrator's saved decision only. */
  decision: 'approve' | 'reject'
  /** Always true: a view exists only for a matching decision record. */
  hasDecisionRecord: true
  /** The administrator's explanation (approvals and rejections alike). */
  explanation: string | null
  /** ISO timestamp (UTC) of the decision. */
  decidedAt: string | null
}

export function toIncompleteExamDecisionView(data: unknown): IncompleteExamDecisionView | null {
  const body = data as {
    decision?: string | null
    has_decision_record?: boolean
    explanation?: string | null
    decided_at?: string | null
  } | null
  if (!body || body.has_decision_record !== true) return null
  if (body.decision !== 'approve' && body.decision !== 'reject') return null
  return {
    decision: body.decision,
    hasDecisionRecord: true,
    explanation: text(body.explanation),
    decidedAt: utc(body.decided_at),
  }
}

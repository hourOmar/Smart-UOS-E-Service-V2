import { supabase } from './supabase'
import { toIncompleteExamDecisionView, type IncompleteExamDecisionView } from '../utils/incompleteExamStudentDecision'

// The decision on the signed-in student's own decided Incomplete Exam request
// (database function get_my_incomplete_exam_decision, which returns nothing
// for any other request, or one still In Progress). A decision is accepted
// only with a matching administrative decision record (see
// utils/incompleteExamStudentDecision.ts); otherwise the result is null.
// Throws when it cannot be loaded, so a loading failure is never shown as
// "no explanation".

export { toIncompleteExamDecisionView }
export type { IncompleteExamDecisionView }

export async function fetchIncompleteExamDecision(requestId: string): Promise<IncompleteExamDecisionView | null> {
  const { data, error } = await supabase.rpc('get_my_incomplete_exam_decision', { p_request_id: requestId })
  if (error) throw error
  return toIncompleteExamDecisionView(data)
}

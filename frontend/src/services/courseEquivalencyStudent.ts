import { supabase } from './supabase'
import {
  toCourseEquivalencyDecisionView,
  type CourseEquivalencyDecisionView,
} from '../utils/courseEquivalencyStudentDecision'

// The decision on the signed-in student's own decided Course Equivalency request
// (database function get_my_course_equivalency_decision, which returns nothing for any
// other request, or one still In Progress). A decision is accepted only with a matching
// administrative decision record (see utils/courseEquivalencyStudentDecision.ts); otherwise
// the result is null. Throws when it cannot be loaded, so a loading failure is never shown
// as "no explanation". Read only: students cannot change a decision.

export { toCourseEquivalencyDecisionView }
export type { CourseEquivalencyDecisionView }

export async function fetchCourseEquivalencyDecision(requestId: string): Promise<CourseEquivalencyDecisionView | null> {
  const { data, error } = await supabase.rpc('get_my_course_equivalency_decision', { p_request_id: requestId })
  if (error) throw error
  return toCourseEquivalencyDecisionView(data)
}

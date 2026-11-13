import { supabase } from './supabase'
import {
  toCourseSubstitutionDecisionView,
  type CourseSubstitutionDecisionView,
} from '../utils/courseSubstitutionStudentDecision'

// The decision on the signed-in student's own decided Course Substitution
// request (database function get_my_course_substitution_decision, which
// returns nothing for any other request, or one still In Progress). A decision
// is accepted only with a matching administrative decision record (see
// utils/courseSubstitutionStudentDecision.ts); otherwise the result is null.
// Throws when it cannot be loaded, so a loading failure is never shown as
// "no explanation".

export { toCourseSubstitutionDecisionView }
export type { CourseSubstitutionDecisionView }

export async function fetchCourseSubstitutionDecision(requestId: string): Promise<CourseSubstitutionDecisionView | null> {
  const { data, error } = await supabase.rpc('get_my_course_substitution_decision', { p_request_id: requestId })
  if (error) throw error
  return toCourseSubstitutionDecisionView(data)
}

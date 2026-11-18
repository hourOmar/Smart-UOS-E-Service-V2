import { supabase } from './supabase'
import {
  CourseSubstitutionSubmitError,
  parseCourseSubstitutionOptions,
  submitErrorCode,
  type CourseOption,
  type CourseSubstitutionOptions,
} from '../utils/courseSubstitutionSubmission'

// The student's Course Substitution request, with the signed-in student's own
// session only. Both database functions identify the student from the session;
// no student ID is ever sent:
// - get_my_course_substitution_options: the Required (original) and Elective
//   (proposed) courses of the current study plan of the student's program
//   that the student has not passed and is not taking (the student cannot
//   read the study plan table directly);
// - submit_course_substitution_request: enforces the same rules again and
//   writes Request and Course_Substitution together.

export { CourseSubstitutionSubmitError }
export type { CourseOption, CourseSubstitutionOptions }

/** The student's course options. Throws when the call itself fails; a reply
 *  this page does not understand is status 'unexpected'. */
export async function fetchCourseSubstitutionOptions(): Promise<CourseSubstitutionOptions> {
  const { data, error } = await supabase.rpc('get_my_course_substitution_options')
  if (error) throw error
  return parseCourseSubstitutionOptions(data)
}

/** Saves the request; returns the new Request_ID. */
export async function submitCourseSubstitutionRequest(
  originalCourseId: string,
  proposedCourseId: string,
  reason: string,
): Promise<string> {
  let result
  try {
    result = await supabase.rpc('submit_course_substitution_request', {
      p_original_course_id: originalCourseId,
      p_proposed_course_id: proposedCourseId,
      p_reason: reason.trim(),
    })
  } catch {
    throw new CourseSubstitutionSubmitError('unknown')
  }
  const { data, error } = result
  if (error) throw new CourseSubstitutionSubmitError(submitErrorCode(error))
  if (typeof data !== 'string' || data === '') throw new CourseSubstitutionSubmitError('unknown')
  return data
}

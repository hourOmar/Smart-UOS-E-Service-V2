import { supabase } from './supabase'
import {
  CourseSubstitutionSubmitError,
  buildCourseOptions,
  submitErrorCode,
  type CourseOption,
} from '../utils/courseSubstitutionSubmission'

// The student's Course Substitution request, with the signed-in student's own
// session only:
// - the course list comes from public."Course" exactly as stored;
// - the student record check reads only the account's own Student row;
// - submit_course_substitution_request identifies the student from the
//   session and writes Request and Course_Substitution together. No student
//   ID is ever sent.

export { CourseSubstitutionSubmitError }
export type { CourseOption }

/** Every course, sorted by ID. */
export async function fetchCourses(): Promise<CourseOption[]> {
  const { data, error } = await supabase.from('Course').select('Course_ID, Course_Name, Credit_Hours')
  if (error) throw error
  return buildCourseOptions((data ?? []) as Record<string, unknown>[])
}

/** Whether the signed-in account is linked to a student record. */
export async function hasStudentRecord(): Promise<boolean> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) return false

  const { data, error } = await supabase.from('Student').select('Student_ID').eq('Auth_User_ID', user.id).maybeSingle()
  if (error) throw error
  return data !== null
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

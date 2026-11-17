import { supabase } from './supabase'
import {
  CourseEquivalencySubmitError,
  UNEXPECTED_OPTIONS,
  isSignedOutError,
  parseCourseEquivalencyOptions,
  submitErrorCode,
  type CourseEquivalencyOptions,
} from '../utils/courseEquivalencySubmission'

// The student's Course Equivalency request, with the signed-in student's own
// session only. Both database functions identify the student from the session;
// no student ID is ever sent, and nothing is read or written directly.

export { CourseEquivalencySubmitError }
export type { CourseEquivalencyOptions }

/** Thrown when the options could not be loaded at all (network failure). */
export class CourseEquivalencyLoadError extends Error {
  constructor() {
    super('The Course Equivalency options could not be loaded.')
    this.name = 'CourseEquivalencyLoadError'
  }
}

/** The applicable program and both course lists, or a blocked status. */
export async function fetchCourseEquivalencyOptions(): Promise<CourseEquivalencyOptions> {
  let result
  try {
    result = await supabase.rpc('get_my_course_equivalency_options')
  } catch {
    throw new CourseEquivalencyLoadError()
  }
  const { data, error } = result
  if (error) {
    if (isSignedOutError(error)) return { ...UNEXPECTED_OPTIONS, status: 'signed_out' }
    throw new CourseEquivalencyLoadError()
  }
  return parseCourseEquivalencyOptions(data)
}

/** Saves the request; returns the new Request_ID only once the database has
 *  confirmed it. */
export async function submitCourseEquivalencyRequest(
  oldCourseId: string,
  newCourseId: string,
  reason: string,
): Promise<string> {
  let result
  try {
    result = await supabase.rpc('submit_course_equivalency_request', {
      p_old_course_id: oldCourseId,
      p_new_course_id: newCourseId,
      p_reason: reason.trim(),
    })
  } catch {
    throw new CourseEquivalencySubmitError('unknown')
  }
  const { data, error } = result
  if (error) throw new CourseEquivalencySubmitError(submitErrorCode(error))
  if (typeof data !== 'string' || data.trim() === '') throw new CourseEquivalencySubmitError('unknown')
  return data
}

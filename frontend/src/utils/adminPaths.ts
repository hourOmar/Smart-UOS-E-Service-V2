import type { AcademicRequestId } from '../data/academicRequests'

export const ADMIN_HOME_PATH = '/admin'

/** The account menu's page link on admin pages. */
export const ADMIN_HOME_ITEM = { to: ADMIN_HOME_PATH, label: 'Admin home' }

/** The list of one request type, e.g. /admin/requests/raise-capacity */
export function adminTypePath(typeId: AcademicRequestId) {
  return `${ADMIN_HOME_PATH}/requests/${typeId}`
}

/** The staff review page of one Raise Capacity request. */
export function raiseCapacityReviewPath(requestId: string) {
  return `${adminTypePath('raise-capacity')}/${encodeURIComponent(requestId)}`
}

/** The staff review page of one Program Change request. */
export function programChangeReviewPath(requestId: string) {
  return `${adminTypePath('program-change')}/${encodeURIComponent(requestId)}`
}

/** The staff review page of one Incomplete Exam request. */
export function incompleteExamReviewPath(requestId: string) {
  return `${adminTypePath('incomplete-exam')}/${encodeURIComponent(requestId)}`
}

/** The staff review page of one Course Substitution request. */
export function courseSubstitutionReviewPath(requestId: string) {
  return `${adminTypePath('course-substitution')}/${encodeURIComponent(requestId)}`
}

/** Where a review page was opened from, for its back link. */
export type ReviewOrigin = 'dashboard' | 'type-list'

/** The review page of each request type that has one (by Request_Type).
 *  Other types (e.g. Course Equivalency) have no review page yet. */
const REVIEW_PATHS: Readonly<Record<string, (requestId: string) => string>> = {
  'Raise Capacity': raiseCapacityReviewPath,
  'Program Change': programChangeReviewPath,
  'Incomplete Exam': incompleteExamReviewPath,
  'Course Substitution': courseSubstitutionReviewPath,
}

/** The review page of a request, or null when its type has none. */
export function reviewPathFor(requestType: string, requestId: string): string | null {
  return Object.hasOwn(REVIEW_PATHS, requestType) ? REVIEW_PATHS[requestType](requestId) : null
}

/** The admin Student Profile page, e.g. /admin/students/U21100123 */
export function studentProfilePath(studentId: string) {
  return `${ADMIN_HOME_PATH}/students/${encodeURIComponent(studentId)}`
}

/** Router state of a review page opened from a Student Profile, so its
 *  breadcrumb can lead back to that student. */
export interface FromStudentProfile {
  from: 'student-profile'
  studentId: string
}

export function fromStudentProfile(state: unknown): string | null {
  const s = state as Partial<FromStudentProfile> | null
  return s?.from === 'student-profile' && typeof s.studentId === 'string' && s.studentId ? s.studentId : null
}

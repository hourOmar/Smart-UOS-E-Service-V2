import type { AcademicRequestId } from '../data/academicRequests'
import type { AccountMenuItem } from '../components/student/AccountMenu'

export const ADMIN_HOME_PATH = '/admin'

/** Every request of every type and status, with search and filters. */
export const ALL_REQUESTS_PATH = `${ADMIN_HOME_PATH}/requests`

/** The account menu's links on every admin page (above Sign Out). */
export const ADMIN_MENU_ITEMS: AccountMenuItem[] = [{ to: ALL_REQUESTS_PATH, label: 'All Requests' }]

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

/** The staff review page of one Course Equivalency request. */
export function courseEquivalencyReviewPath(requestId: string) {
  return `${adminTypePath('course-equivalency')}/${encodeURIComponent(requestId)}`
}

/** Where a review page was opened from, for its back link. */
export type ReviewOrigin = 'dashboard' | 'type-list' | 'all-requests'

/** Router state of a review page opened from All Requests: the list's query
 *  string, so going back restores its search, filters, sort and page. */
export interface FromAllRequests {
  from: 'all-requests'
  search: string
}

/** The All Requests list to return to (with its saved query string), or null
 *  when the review was not opened from it. Only a plain query string is kept,
 *  so the link always stays on /admin/requests. */
export function allRequestsReturnPath(state: unknown): string | null {
  const s = state as Partial<FromAllRequests> | null
  if (s?.from !== 'all-requests') return null
  const search = typeof s.search === 'string' && /^\?[^#\s/\\]*$/.test(s.search) ? s.search : ''
  return `${ALL_REQUESTS_PATH}${search}`
}

/** The review page of each request type that has one (by Request_Type). */
const REVIEW_PATHS: Readonly<Record<string, (requestId: string) => string>> = {
  'Raise Capacity': raiseCapacityReviewPath,
  'Program Change': programChangeReviewPath,
  'Incomplete Exam': incompleteExamReviewPath,
  'Course Substitution': courseSubstitutionReviewPath,
  'Course Equivalency': courseEquivalencyReviewPath,
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

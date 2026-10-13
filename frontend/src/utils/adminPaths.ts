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

/** Where a review page was opened from, for its back link. */
export type ReviewOrigin = 'dashboard' | 'type-list'

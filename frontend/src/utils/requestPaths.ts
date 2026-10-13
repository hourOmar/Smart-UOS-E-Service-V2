export const MY_REQUESTS_PATH = '/student/requests'

/** Anchor of the dashboard's Recent Requests section. */
export const RECENT_REQUESTS_ANCHOR_ID = 'recent-requests'

export function requestDetailsPath(requestId: string) {
  return `${MY_REQUESTS_PATH}/${encodeURIComponent(requestId)}`
}

/** Where a request-details page was opened from, for its back link. */
export type RequestsOrigin = 'dashboard' | 'my-requests'

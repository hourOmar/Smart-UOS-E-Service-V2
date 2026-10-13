// How a stored request status is shown. Raise Capacity requests stored as
// 'Completed' (approved by staff) are shown as 'Approved'; every other type and
// status is shown as stored. Filters and queries keep using the stored value.

export const RAISE_CAPACITY = 'Raise Capacity'

export function statusLabel(status: string, requestType?: string | null): string {
  return requestType === RAISE_CAPACITY && status === 'Completed' ? 'Approved' : status
}

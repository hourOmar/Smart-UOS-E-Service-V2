// How a stored request status is shown. Raise Capacity and Program Change
// requests stored as 'Completed' (approved by staff) are shown as 'Approved';
// every other type and status is shown as stored. Filters and queries keep
// using the stored value.

export const RAISE_CAPACITY = 'Raise Capacity'
export const PROGRAM_CHANGE = 'Program Change'

// Request types whose 'Completed' status means an approval.
const APPROVAL_TYPES: ReadonlySet<string> = new Set([RAISE_CAPACITY, PROGRAM_CHANGE])

export function statusLabel(status: string, requestType?: string | null): string {
  return status === 'Completed' && requestType != null && APPROVAL_TYPES.has(requestType) ? 'Approved' : status
}

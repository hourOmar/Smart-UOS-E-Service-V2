// How a stored request status is shown. Filters and queries keep using the
// stored value.
// - Raise Capacity and Program Change: 'Completed' always means approved by
//   staff, so it is shown as 'Approved'.
// - Incomplete Exam and Course Substitution: 'Completed' is shown as
//   'Approved' only when the caller knows a matching approval decision record
//   exists (Decision_Type 'Incomplete Exam Approved' / 'Course Substitution
//   Approved'). Requests completed before decisions were recorded, or views
//   that do not load the decision, keep 'Completed'.
// - Every other type and status is shown as stored.

export const RAISE_CAPACITY = 'Raise Capacity'
export const PROGRAM_CHANGE = 'Program Change'
export const INCOMPLETE_EXAM = 'Incomplete Exam'
export const COURSE_SUBSTITUTION = 'Course Substitution'

// Request types whose 'Completed' status always means an approval.
const APPROVAL_TYPES: ReadonlySet<string> = new Set([RAISE_CAPACITY, PROGRAM_CHANGE])

// Request types whose 'Completed' status is an approval only with a recorded approval decision.
const RECORDED_APPROVAL_TYPES: ReadonlySet<string> = new Set([INCOMPLETE_EXAM, COURSE_SUBSTITUTION])

/**
 * @param approvalRecorded true only when a matching administrative approval
 *   decision record is known to exist for this request.
 */
export function statusLabel(status: string, requestType?: string | null, approvalRecorded = false): string {
  if (status !== 'Completed' || requestType == null) return status
  if (APPROVAL_TYPES.has(requestType)) return 'Approved'
  if (RECORDED_APPROVAL_TYPES.has(requestType) && approvalRecorded === true) return 'Approved'
  return status
}

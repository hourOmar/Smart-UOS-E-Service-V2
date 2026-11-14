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

/** The Decision_Type that records an approval, for each type whose
 *  'Completed' needs one before it reads "Approved". */
export const APPROVAL_DECISION_TYPES: Readonly<Record<string, string>> = {
  [INCOMPLETE_EXAM]: 'Incomplete Exam Approved',
  [COURSE_SUBSTITUTION]: 'Course Substitution Approved',
}

/** Whether a request's label depends on a recorded approval decision: a
 *  Completed request of Incomplete Exam or Course Substitution. Lists load the
 *  decision only for these rows. */
export function needsApprovalRecord(status: string, requestType?: string | null): boolean {
  return status === 'Completed' && requestType != null && RECORDED_APPROVAL_TYPES.has(requestType)
}

/** The IDs of the requests that have a matching approval decision record:
 *  Completed, of a recorded-approval type, with a decision of exactly that
 *  type's '<type> Approved'. A decision of another type, or on a request that
 *  does not need one, never counts. */
export function recordedApprovalIds(
  requests: readonly { id: string; type: string; status: string }[],
  decisions: readonly { requestId: string; decisionType: string }[],
): Set<string> {
  const typeById = new Map(
    requests.filter((r) => needsApprovalRecord(r.status, r.type)).map((r) => [r.id, r.type] as const),
  )
  const ids = new Set<string>()
  for (const d of decisions) {
    const type = typeById.get(d.requestId)
    if (type !== undefined && APPROVAL_DECISION_TYPES[type] === d.decisionType) ids.add(d.requestId)
  }
  return ids
}

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

// The admin All Requests list (/admin/requests): its URL state, the status
// filter as shown on the badges, and the PostgREST filter strings. Kept free of
// network imports so it can be tested on its own (tests/adminAllRequests.test.ts);
// services/adminRequests.ts runs the query.
//
// Statuses: the database stores In Progress, Completed and Rejected. The list
// filters by the status the badge shows (utils/statusLabels.ts):
//   - Approved  = Completed Raise Capacity / Program Change, or a Completed
//                 Incomplete Exam / Course Substitution / Course Equivalency
//                 request with a matching approval decision record;
//   - Completed = a Completed request of those three types WITHOUT one
//                 (legacy records), shown as stored.
// Stored values are never changed.
import { academicRequestTypes } from '../data/academicRequests.ts'
import { APPROVAL_DECISION_TYPES, recordedApprovalIds } from './statusLabels.ts'

export const ALL_REQUESTS_PAGE_SIZE = 10
export const SEARCH_MAX_LENGTH = 100

/** Request types in catalog order; names equal Request.Request_Type. */
export const ALL_REQUEST_TYPES: readonly string[] = academicRequestTypes.map((type) => type.name)

/** The statuses the badges show, in filter order. */
export const DISPLAY_STATUSES = ['In Progress', 'Approved', 'Completed', 'Rejected'] as const
export type DisplayStatus = (typeof DISPLAY_STATUSES)[number]

/** The statuses offered by the Status filter (and accepted from the URL).
 *  'Completed' (a legacy Completed record without a recorded approval) is not
 *  offered; such requests still appear under All statuses. */
export const FILTER_STATUSES: readonly DisplayStatus[] = ['In Progress', 'Approved', 'Rejected']

export type SortOrder = 'newest' | 'oldest'

export interface AllRequestsFilters {
  search: string
  type: string | null
  status: DisplayStatus | null
  /** Submission date range, inclusive (YYYY-MM-DD). */
  from: string | null
  to: string | null
  sort: SortOrder
  page: number
}

export const DEFAULT_ALL_REQUESTS_FILTERS: AllRequestsFilters = {
  search: '',
  type: null,
  status: null,
  from: null,
  to: null,
  sort: 'newest',
  page: 1,
}

// ---------------------------------------------------------------------------
// URL state (?q=&type=&status=&from=&to=&sort=&page=)

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar date in YYYY-MM-DD form, or null. */
export function validDate(value: string | null): string | null {
  if (!value || !ISO_DATE.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}

/** The filters in the URL; anything unknown or malformed falls back to its default. */
export function parseAllRequestsParams(params: URLSearchParams): AllRequestsFilters {
  const type = params.get('type')
  const status = params.get('status')
  const page = Number(params.get('page'))
  return {
    search: (params.get('q') ?? '').trim().slice(0, SEARCH_MAX_LENGTH),
    type: type !== null && ALL_REQUEST_TYPES.includes(type) ? type : null,
    status: FILTER_STATUSES.find((s) => s === status) ?? null,
    from: validDate(params.get('from')),
    to: validDate(params.get('to')),
    sort: params.get('sort') === 'oldest' ? 'oldest' : 'newest',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  }
}

/** The URL parameters for these filters; defaults are left out. */
export function toAllRequestsParams(filters: AllRequestsFilters): URLSearchParams {
  const params = new URLSearchParams()
  const search = filters.search.trim()
  if (search) params.set('q', search)
  if (filters.type) params.set('type', filters.type)
  if (filters.status) params.set('status', filters.status)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.sort === 'oldest') params.set('sort', 'oldest')
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

/** Whether anything differs from the unfiltered, newest-first first page. */
export function hasActiveFilters(filters: AllRequestsFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.type !== null ||
    filters.status !== null ||
    filters.from !== null ||
    filters.to !== null ||
    filters.sort !== 'newest'
  )
}

export function dateRangeError(from: string | null, to: string | null): string | null {
  return from && to && from > to ? 'The From date must be on or before the To date.' : null
}

// ---------------------------------------------------------------------------
// Status filter

/** Types whose Completed status always means an approval. */
export const ALWAYS_APPROVED_TYPES: readonly string[] = ['Raise Capacity', 'Program Change']
/** Types whose Completed status is an approval only with a recorded approval decision. */
export const RECORDED_APPROVAL_TYPES: readonly string[] = Object.keys(APPROVAL_DECISION_TYPES)

export type StatusPlan =
  | { kind: 'any' }
  /** Exactly one stored status (In Progress or Rejected). */
  | { kind: 'stored'; stored: 'In Progress' | 'Rejected' }
  /** Completed, and an approval (needs the recorded approval IDs). */
  | { kind: 'approved'; stored: 'Completed' }
  /** Completed of a recorded-approval type without a recorded approval. */
  | { kind: 'unconfirmed'; stored: 'Completed' }

export function statusPlan(status: DisplayStatus | null): StatusPlan {
  switch (status) {
    case 'In Progress':
    case 'Rejected':
      return { kind: 'stored', stored: status }
    case 'Approved':
      return { kind: 'approved', stored: 'Completed' }
    case 'Completed':
      return { kind: 'unconfirmed', stored: 'Completed' }
    default:
      return { kind: 'any' }
  }
}

export function needsApprovalIds(plan: StatusPlan): boolean {
  return plan.kind === 'approved' || plan.kind === 'unconfirmed'
}

/** One approval decision row as read with its request (Decision -> Request). */
export interface ApprovalDecisionRow {
  Request_ID: unknown
  Decision_Type: unknown
  Request: { Request_Type: unknown; Current_Status: unknown } | { Request_Type: unknown; Current_Status: unknown }[] | null
}

/** The Completed recorded-approval requests that have a matching approval
 *  decision (same rule as the badges: utils/statusLabels.ts). */
export function approvedRequestIds(rows: readonly ApprovalDecisionRow[]): string[] {
  const requests = new Map<string, { id: string; type: string; status: string }>()
  const decisions: { requestId: string; decisionType: string }[] = []
  for (const row of rows) {
    const request = Array.isArray(row.Request) ? row.Request[0] : row.Request
    if (!request) continue
    const id = String(row.Request_ID)
    requests.set(id, { id, type: String(request.Request_Type), status: String(request.Current_Status) })
    decisions.push({ requestId: id, decisionType: String(row.Decision_Type) })
  }
  return [...recordedApprovalIds([...requests.values()], decisions)].sort()
}

// ---------------------------------------------------------------------------
// PostgREST filter strings

/** Characters that would break a PostgREST filter are removed; the rest is
 *  matched case-insensitively anywhere in the value. */
export function searchTerm(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} _.@-]/gu, ' ').replace(/\s+/g, ' ').trim()
}

export const quoted = (value: string) => `"${value}"`

/** "(\"a\",\"b\")" for an in-list, or null when empty. */
export function inList(values: readonly string[]): string | null {
  return values.length ? `(${values.map(quoted).join(',')})` : null
}

/** OR group: Request ID or student ID containing the term (student names are
 *  not searched). */
export function idSearchGroup(term: string): string {
  const pattern = quoted(`%${term}%`)
  return `Request_ID.ilike.${pattern},Student_ID.ilike.${pattern}`
}

/** OR group for "Approved" (with Current_Status = Completed): a type whose
 *  Completed always is an approval, or a request with a recorded approval. */
export function approvedGroup(approvedIds: readonly string[]): string {
  const parts = [`Request_Type.in.${inList(ALWAYS_APPROVED_TYPES)}`]
  const ids = inList(approvedIds)
  if (ids) parts.push(`Request_ID.in.${ids}`)
  return parts.join(',')
}

/** Several OR groups that must all hold, as one value for .or(): a single
 *  group as is, several as and(or(...),or(...)). Null when there are none. */
export function combineOrGroups(groups: readonly string[]): string | null {
  if (groups.length === 0) return null
  if (groups.length === 1) return groups[0]
  return `and(${groups.map((group) => `or(${group})`).join(',')})`
}

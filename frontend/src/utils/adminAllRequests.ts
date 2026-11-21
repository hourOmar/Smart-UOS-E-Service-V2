// The admin All Requests list (/admin/requests): its URL state, the status
// filter as shown on the badges, the submission time window (UAE time), the
// academic term, the Raise Capacity filters, and the PostgREST filter strings.
// Kept free of network imports so it can be tested on its own
// (tests/adminAllRequests.test.ts); services/adminRequests.ts runs the query.
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
import { termName } from './studentProfile.ts'

export const ALL_REQUESTS_PAGE_SIZE = 10
export const SEARCH_MAX_LENGTH = 100

/** Request types in catalog order; names equal Request.Request_Type. */
export const ALL_REQUEST_TYPES: readonly string[] = academicRequestTypes.map((type) => type.name)

export const RAISE_CAPACITY = 'Raise Capacity'
export const INCOMPLETE_EXAM = 'Incomplete Exam'

/** The statuses the badges show, in filter order. */
export const DISPLAY_STATUSES = ['In Progress', 'Approved', 'Completed', 'Rejected'] as const
export type DisplayStatus = (typeof DISPLAY_STATUSES)[number]

/** The statuses offered by the Status filter (and accepted from the URL).
 *  'Completed' (a legacy Completed record without a recorded approval) is not
 *  offered; such requests still appear under All statuses. */
export const FILTER_STATUSES: readonly DisplayStatus[] = ['In Progress', 'Approved', 'Rejected']

export type SortOrder = 'newest' | 'oldest'

/** A filter that cannot be applied correctly (its message is shown as is);
 *  never replaced by an approximate result. */
export class AllRequestsFilterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AllRequestsFilterError'
  }
}

/** Saved Raise Capacity priority levels (Raise_Capacity.Priority_Level), plus
 *  NOT_ASSESSED for a request without a saved level. */
export const PRIORITY_FILTERS = ['HIGH', 'MEDIUM', 'LOW', 'MANUAL_REVIEW', 'NOT_ASSESSED'] as const
export type PriorityFilter = (typeof PRIORITY_FILTERS)[number]
export const PRIORITY_FILTER_LABELS: Readonly<Record<PriorityFilter, string>> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  MANUAL_REVIEW: 'Manual Review',
  NOT_ASSESSED: 'Not Assessed',
}

export interface AllRequestsFilters {
  search: string
  type: string | null
  status: DisplayStatus | null
  /** Submission window in UAE time: dates (YYYY-MM-DD), inclusive, and
   *  optional times (HH:MM, 24-hour; From inclusive, To through the minute). */
  from: string | null
  fromTime: string | null
  to: string | null
  toTime: string | null
  /** Academic term code (YYYY01 Fall, YYYY02 Spring, YYYY03 Summer). */
  term: number | null
  /** Raise Capacity only. */
  priority: PriorityFilter | null
  course: string | null
  section: string | null
  sort: SortOrder
  page: number
}

export const DEFAULT_ALL_REQUESTS_FILTERS: AllRequestsFilters = {
  search: '',
  type: null,
  status: null,
  from: null,
  fromTime: null,
  to: null,
  toTime: null,
  term: null,
  priority: null,
  course: null,
  section: null,
  sort: 'newest',
  page: 1,
}

// ---------------------------------------------------------------------------
// URL state (?q=&type=&status=&from=&fromTime=&to=&toTime=&term=&priority=
//            &course=&section=&sort=&page=)

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/
const COURSE_ID = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,29}$/
const SECTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/

/** A real calendar date in YYYY-MM-DD form, or null. */
export function validDate(value: string | null): string | null {
  if (!value || !ISO_DATE.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}

/** A 24-hour HH:MM time, or null. */
export function validTime(value: string | null): string | null {
  return value && HH_MM.test(value) ? value : null
}

/** A term code YYYY01 / YYYY02 / YYYY03, or null. */
export function validTerm(value: string | number | null): number | null {
  const text = value == null ? '' : String(value)
  if (!/^\d{6}$/.test(text)) return null
  const term = Number(text)
  return term >= 190001 && term <= 999903 && [1, 2, 3].includes(term % 100) ? term : null
}

/**
 * The filters in the URL. Anything unknown or malformed falls back to its
 * default, and dependent values are normalized: a time needs its date, the
 * Raise Capacity filters need that type, a section needs a course.
 */
export function parseAllRequestsParams(params: URLSearchParams): AllRequestsFilters {
  const rawType = params.get('type')
  const type = rawType !== null && ALL_REQUEST_TYPES.includes(rawType) ? rawType : null
  const status = params.get('status')
  const page = Number(params.get('page'))
  const from = validDate(params.get('from'))
  const to = validDate(params.get('to'))
  const isRc = type === RAISE_CAPACITY
  const course = isRc ? (COURSE_ID.test(params.get('course') ?? '') ? (params.get('course') as string) : null) : null
  const section = course && SECTION_ID.test(params.get('section') ?? '') ? (params.get('section') as string) : null
  return {
    search: (params.get('q') ?? '').trim().slice(0, SEARCH_MAX_LENGTH),
    type,
    status: FILTER_STATUSES.find((s) => s === status) ?? null,
    from,
    fromTime: from ? validTime(params.get('fromTime')) : null,
    to,
    toTime: to ? validTime(params.get('toTime')) : null,
    term: validTerm(params.get('term')),
    priority: isRc ? (PRIORITY_FILTERS.find((p) => p === params.get('priority')) ?? null) : null,
    course,
    section,
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
  if (filters.from && filters.fromTime) params.set('fromTime', filters.fromTime)
  if (filters.to) params.set('to', filters.to)
  if (filters.to && filters.toTime) params.set('toTime', filters.toTime)
  if (filters.term != null) params.set('term', String(filters.term))
  if (filters.type === RAISE_CAPACITY) {
    if (filters.priority) params.set('priority', filters.priority)
    if (filters.course) params.set('course', filters.course)
    if (filters.course && filters.section) params.set('section', filters.section)
  }
  if (filters.sort === 'oldest') params.set('sort', 'oldest')
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

/** The normalized URL for a set of parameters (to keep the URL in step with
 *  the controls: dropped or invalid values disappear from it). */
export function canonicalAllRequestsParams(params: URLSearchParams): URLSearchParams {
  return toAllRequestsParams(parseAllRequestsParams(params))
}

/**
 * The filters after a change. Every change returns to page 1 unless it sets
 * the page; leaving Raise Capacity clears its filters; a new or cleared
 * course clears the section; a cleared date clears its time.
 */
export function applyFilterPatch(current: AllRequestsFilters, patch: Partial<AllRequestsFilters>): AllRequestsFilters {
  const next: AllRequestsFilters = { ...current, page: 1, ...patch }
  if (next.type !== RAISE_CAPACITY) {
    next.priority = null
    next.course = null
    next.section = null
  }
  if ('course' in patch && patch.course !== current.course && !('section' in patch)) next.section = null
  if (!next.course) next.section = null
  if (!next.from) next.fromTime = null
  if (!next.to) next.toTime = null
  return parseAllRequestsParams(toAllRequestsParams(next))
}

/** Whether anything differs from the unfiltered, newest-first first page. */
export function hasActiveFilters(filters: AllRequestsFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.type !== null ||
    filters.status !== null ||
    filters.from !== null ||
    filters.to !== null ||
    filters.term != null ||
    filters.priority != null ||
    filters.course != null ||
    filters.sort !== 'newest'
  )
}

/** How many advanced filters (the drawer) are set: the term, the From
 *  date (with its time) and the To date (with its time). */
export function moreFiltersCount(filters: AllRequestsFilters): number {
  return [filters.term, filters.from, filters.to].filter((v) => v != null).length
}

/** "Reset advanced filters": the term and the submission window only; the
 *  toolbar and Raise Capacity filters are kept. */
export const ADVANCED_FILTERS_RESET: Partial<AllRequestsFilters> = {
  term: null,
  from: null,
  fromTime: null,
  to: null,
  toTime: null,
}

// ---------------------------------------------------------------------------
// Active filter chips

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Nov 21, 2026" (the list's date style), plus ", 14:30" when a time is set. */
function chipDate(date: string, time: string | null): string {
  const [y, m, d] = date.split('-').map(Number)
  const text = `${MONTHS[m - 1]} ${d}, ${y}`
  return time ? `${text}, ${time}` : text
}

export interface FilterChip {
  key: string
  label: string
  /** The change that removes this filter (and anything that depends on it). */
  remove: Partial<AllRequestsFilters>
}

/** One readable, removable chip per active filter (none when unfiltered). */
export function activeFilterChips(filters: AllRequestsFilters): FilterChip[] {
  const chips: FilterChip[] = []
  if (filters.type) chips.push({ key: 'type', label: filters.type, remove: { type: null } })
  if (filters.status) chips.push({ key: 'status', label: filters.status, remove: { status: null } })
  if (filters.priority) {
    chips.push({ key: 'priority', label: `${PRIORITY_FILTER_LABELS[filters.priority]} Priority`, remove: { priority: null } })
  }
  if (filters.course) chips.push({ key: 'course', label: `Course ${filters.course}`, remove: { course: null, section: null } })
  if (filters.section) chips.push({ key: 'section', label: `Section ${filters.section}`, remove: { section: null } })
  if (filters.term != null) chips.push({ key: 'term', label: termLabel(filters.term), remove: { term: null } })
  if (filters.from) {
    chips.push({ key: 'from', label: `From ${chipDate(filters.from, filters.fromTime)}`, remove: { from: null, fromTime: null } })
  }
  if (filters.to) chips.push({ key: 'to', label: `To ${chipDate(filters.to, filters.toTime)}`, remove: { to: null, toTime: null } })
  const search = filters.search.trim()
  if (search) chips.push({ key: 'search', label: `Search: ${search}`, remove: { search: '' } })
  if (filters.sort === 'oldest') chips.push({ key: 'sort', label: 'Oldest first', remove: { sort: 'newest' } })
  return chips
}

/** An impossible window (From after To, compared in UAE time). */
export function dateRangeError(
  from: string | null,
  to: string | null,
  fromTime: string | null = null,
  toTime: string | null = null,
): string | null {
  if (!from || !to) return null
  return `${from}T${fromTime ?? '00:00'}` > `${to}T${toTime ?? '23:59'}`
    ? 'The From date and time must be on or before the To date and time.'
    : null
}

// ---------------------------------------------------------------------------
// Submission window: UAE time in the interface, UTC in the database
//
// Request_Date and Submission_Time hold the UTC date and time of submission
// (their database defaults; the database runs in UTC). The UAE is UTC+4 all
// year (no daylight saving), so a UAE boundary is moved back 4 hours, which
// can change the date. A date alone means that whole UAE calendar day.

export const UAE_UTC_OFFSET_MINUTES = 240

export interface UtcBoundary {
  /** UTC date, YYYY-MM-DD. */
  date: string
  /** UTC time, HH:MM:SS. */
  time: string
}

function toUtcBoundary(date: string, time: string, extraMinutes = 0): UtcBoundary {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const ms = Date.UTC(y, m - 1, d, hh, mm) - (UAE_UTC_OFFSET_MINUTES - extraMinutes) * 60_000
  const iso = new Date(ms).toISOString()
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) }
}

/** The first UTC moment included by a UAE From date (and optional time). */
export function submittedFromUtc(date: string, time: string | null): UtcBoundary {
  return toUtcBoundary(date, time ?? '00:00')
}

/** The first UTC moment AFTER a UAE To date (and optional time): the end of
 *  the selected minute, or of the whole day when no time is given. */
export function submittedToUtcExclusive(date: string, time: string | null): UtcBoundary {
  return toUtcBoundary(date, time ?? '23:59', 1)
}

/** OR group: submitted at or after the boundary (date and time compared together). */
export function submittedFromGroup(b: UtcBoundary): string {
  return `Request_Date.gt.${b.date},and(Request_Date.eq.${b.date},Submission_Time.gte.${quoted(b.time)})`
}

/** OR group: submitted before the (exclusive) boundary. */
export function submittedBeforeGroup(b: UtcBoundary): string {
  return `Request_Date.lt.${b.date},and(Request_Date.eq.${b.date},Submission_Time.lt.${quoted(b.time)})`
}

// ---------------------------------------------------------------------------
// Academic term
//
// Stored for Raise Capacity (Raise_Capacity.Term) and Incomplete Exam
// (Incomplete_Exam.Term): the requested term. Program Change, Course
// Equivalency and Course Substitution store none, so their term is the
// semester of the submission date (Request_Date): August-December = Fall
// (YYYY01), January-May = Spring (previous year + 02), June-July = Summer
// (previous year + 03). Course_Equivalency.Old_Course_Term is the term of the
// old course's grade, not the request's term, and is not used.

export const STORED_TERM_TABLES: Readonly<Record<string, string>> = {
  [RAISE_CAPACITY]: 'Raise_Capacity',
  [INCOMPLETE_EXAM]: 'Incomplete_Exam',
}
export const DERIVED_TERM_TYPES: readonly string[] = ['Program Change', 'Course Equivalency', 'Course Substitution']

/** The term of a submission date (YYYY-MM-DD) for the types without a stored term. */
export function termFromSubmissionDate(date: string): number {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  if (month >= 8) return year * 100 + 1
  if (month <= 5) return (year - 1) * 100 + 2
  return (year - 1) * 100 + 3
}

/** The submission dates (inclusive) of a term, for the derived types. */
export function termSubmissionDates(term: number): { start: string; end: string } {
  const year = Math.floor(term / 100)
  switch (term % 100) {
    case 1:
      return { start: `${year}-08-01`, end: `${year}-12-31` }
    case 2:
      return { start: `${year + 1}-01-01`, end: `${year + 1}-05-31` }
    default:
      return { start: `${year + 1}-06-01`, end: `${year + 1}-07-31` }
  }
}

/** "Fall 2026", "Spring 2027", "Summer 2027" (any other code as stored). */
export function termLabel(term: number): string {
  return termName(term)
}

/** How the query applies a term filter for the selected type. */
export type TermPlan =
  | { kind: 'stored'; table: string }
  | { kind: 'derived'; start: string; end: string }
  /** All types: a stored term (either table) or a derived term. */
  | { kind: 'mixed'; group: string }

/** Aliases of the empty embeds used by the mixed term filter. */
export const RC_TERM_ALIAS = 'rcTerm'
export const IE_TERM_ALIAS = 'ieTerm'

export function termPlan(term: number, type: string | null): TermPlan {
  if (type && STORED_TERM_TABLES[type]) return { kind: 'stored', table: STORED_TERM_TABLES[type] }
  const { start, end } = termSubmissionDates(term)
  if (type) return { kind: 'derived', start, end }
  // Documented PostgREST form: empty embeds filtered on Term, combined in an
  // OR with not.is.null (a request matches through its own table only).
  return {
    kind: 'mixed',
    group:
      `${RC_TERM_ALIAS}.not.is.null,${IE_TERM_ALIAS}.not.is.null,` +
      `and(Request_Type.in.${inList(DERIVED_TERM_TYPES)},Request_Date.gte.${start},Request_Date.lte.${end})`,
  }
}

/** Term options, newest first, from the terms present in the data. */
export function termOptions(terms: Iterable<number>): { value: number; label: string }[] {
  return [...new Set(terms)].filter((t) => Number.isInteger(t)).sort((a, b) => b - a).map((value) => ({ value, label: termLabel(value) }))
}

// ---------------------------------------------------------------------------
// Raise Capacity priority

/** One row of get_raise_capacity_priorities: a request and its saved level. */
export interface PriorityLevelRow {
  Request_ID: unknown
  Priority_Level: unknown
}

/** Most IDs a priority filter puts in one query (keeps the request URL short).
 *  A larger set is refused with a clear message, never truncated. */
export const MAX_FILTER_IDS = 400

export type PriorityIdFilter =
  /** Only these requests (empty = nothing matches). */
  | { mode: 'in'; ids: string[] }
  /** Every Raise Capacity request except these (the assessed ones). */
  | { mode: 'not-in'; ids: string[] }

export function priorityIdFilter(priority: PriorityFilter, rows: readonly PriorityLevelRow[]): PriorityIdFilter {
  const level = (row: PriorityLevelRow) => (row.Priority_Level == null ? '' : String(row.Priority_Level).trim().toUpperCase())
  if (priority === 'NOT_ASSESSED') {
    return { mode: 'not-in', ids: rows.filter((r) => level(r) !== '').map((r) => String(r.Request_ID)).sort() }
  }
  return { mode: 'in', ids: rows.filter((r) => level(r) === priority).map((r) => String(r.Request_ID)).sort() }
}

// ---------------------------------------------------------------------------
// Raise Capacity course and section options (from the requests themselves)

export interface RaiseCapacityTarget {
  Course_ID: unknown
  Section_ID: unknown
  Term: unknown
}

export interface SectionOption {
  value: string
  label: string
}

/** The distinct courses of Raise Capacity requests. */
export function requestedCourseIds(rows: readonly RaiseCapacityTarget[]): string[] {
  return [...new Set(rows.map((r) => String(r.Course_ID ?? '').trim()).filter(Boolean))].sort()
}

/** The distinct sections requested for a course; the term is added to the
 *  label when the same section number was requested in several terms. */
export function requestedSections(rows: readonly RaiseCapacityTarget[], courseId: string | null): SectionOption[] {
  if (!courseId) return []
  const terms = new Map<string, Set<number>>()
  for (const row of rows) {
    if (String(row.Course_ID ?? '').trim() !== courseId) continue
    const section = String(row.Section_ID ?? '').trim()
    if (!section) continue
    if (!terms.has(section)) terms.set(section, new Set())
    const term = Number(row.Term)
    if (Number.isInteger(term)) terms.get(section)?.add(term)
  }
  return [...terms.keys()]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((value) => {
      const sectionTerms = [...(terms.get(value) ?? [])].sort((a, b) => b - a)
      const label = sectionTerms.length > 1 ? `Section ${value} (${sectionTerms.map(termLabel).join(', ')})` : `Section ${value}`
      return { value, label }
    })
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

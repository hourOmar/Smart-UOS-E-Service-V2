import { supabase } from './supabase'
import { academicRequestTypes } from '../data/academicRequests'
import { APPROVAL_DECISION_TYPES, needsApprovalRecord, recordedApprovalIds } from '../utils/statusLabels'
import {
  ALL_REQUESTS_PAGE_SIZE,
  RECORDED_APPROVAL_TYPES,
  approvedGroup,
  approvedRequestIds,
  combineOrGroups,
  inList,
  needsApprovalIds,
  quoted,
  searchTerm,
  statusPlan,
  studentSearchGroup,
  type AllRequestsFilters,
  type ApprovalDecisionRow,
} from '../utils/adminAllRequests'

// Read-only queries for the admin home. They run with the signed-in staff
// member's session; the database policies let linked staff read every
// request and student. Statuses are shown as the database stores them.

/** The status a request has until a decision is recorded. */
export const IN_PROGRESS = 'In Progress'

/** Request types in catalog order; names equal Request.Request_Type. */
export const REQUEST_TYPE_NAMES = academicRequestTypes.map((type) => type.name)

// ---------------------------------------------------------------------------
// Signed-in staff member

export async function fetchStaffIdentity(): Promise<{ fullName: string | null; email: string | null }> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError || !user) throw userError ?? new Error('Not signed in')

  const { data, error } = await supabase
    .from('Authorized_Staff')
    .select('Staff_Name, Staff_Email')
    .eq('Auth_User_ID', user.id)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('No staff record for this account')

  const staff = data as { Staff_Name: string | null; Staff_Email: string | null }
  return {
    fullName: staff.Staff_Name?.trim() || null,
    email: staff.Staff_Email?.trim() || user.email || null,
  }
}

// ---------------------------------------------------------------------------
// Totals per request type

export interface RequestTypeCount {
  type: string
  total: number
  inProgress: number
}

async function countRequests(type: string, status?: string): Promise<number> {
  let query = supabase
    .from('Request')
    .select('Request_ID', { count: 'exact', head: true })
    .eq('Request_Type', type)
  if (status) query = query.eq('Current_Status', status)
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

// Exact counts (not a row download), so totals stay correct however many
// requests there are.
export async function fetchRequestTypeCounts(): Promise<RequestTypeCount[]> {
  return Promise.all(
    REQUEST_TYPE_NAMES.map(async (type) => {
      const [total, inProgress] = await Promise.all([
        countRequests(type),
        countRequests(type, IN_PROGRESS),
      ])
      return { type, total, inProgress }
    }),
  )
}

// ---------------------------------------------------------------------------
// Requests with their student

export interface AdminRequestRow {
  id: string
  type: string
  date: string
  status: string
  studentId: string
  studentName: string | null
  /** A matching approval decision record exists, so a Completed Incomplete
   *  Exam / Course Substitution request reads "Approved" (as on its review
   *  page). False: shown as stored. */
  approvalRecorded: boolean
}

interface RequestWithStudent {
  Request_ID: string
  Request_Type: string
  Request_Date: string
  Current_Status: string
  Student_ID: string
  Student: { Student_Name: string | null } | { Student_Name: string | null }[] | null
}

const REQUEST_WITH_STUDENT =
  'Request_ID, Request_Type, Request_Date, Current_Status, Student_ID, Student(Student_Name)'

function toAdminRow(row: RequestWithStudent): AdminRequestRow {
  const student = Array.isArray(row.Student) ? row.Student[0] : row.Student
  return {
    id: row.Request_ID,
    type: row.Request_Type,
    date: row.Request_Date,
    status: row.Current_Status,
    studentId: String(row.Student_ID),
    studentName: student?.Student_Name?.trim() || null,
    approvalRecorded: false,
  }
}

// Marks the Completed Incomplete Exam / Course Substitution rows that have a
// matching approval decision, with one read of Decision (staff may read
// decisions) for just those rows. If decisions cannot be read, the rows keep
// their stored status ('Completed'), never a guessed "Approved".
async function withRecordedApprovals<T extends AdminRequestRow>(rows: T[]): Promise<T[]> {
  const needed = rows.filter((row) => needsApprovalRecord(row.status, row.type))
  if (needed.length === 0) return rows
  const { data, error } = await supabase
    .from('Decision')
    .select('Request_ID, Decision_Type')
    .in('Request_ID', needed.map((row) => row.id))
    .in('Decision_Type', Object.values(APPROVAL_DECISION_TYPES))
  if (error) return rows
  const approved = recordedApprovalIds(
    needed,
    ((data ?? []) as { Request_ID: unknown; Decision_Type: unknown }[]).map((d) => ({
      requestId: String(d.Request_ID),
      decisionType: String(d.Decision_Type),
    })),
  )
  return rows.map((row) => (approved.has(row.id) ? { ...row, approvalRecorded: true } : row))
}

// A filtered, ordered request query that can be asked for one page.
interface PageQuery {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; count: number | null; error: { code?: string } | null }>
}

// Fetches one page with an exact total. If the page no longer exists
// (e.g. decisions emptied the last page while it was open), PostgREST
// answers PGRST103; the last existing page is returned instead, and the
// page actually shown is reported back.
async function fetchPage(build: () => PageQuery, page: number, size: number) {
  const pageOf = (p: number) => build().range((p - 1) * size, p * size - 1)

  let shown = page
  let { data, count, error } = await pageOf(shown)
  if (error?.code === 'PGRST103') {
    const head = await build().range(0, 0)
    if (head.error) throw head.error
    shown = Math.max(1, Math.ceil((head.count ?? 0) / size))
    ;({ data, count, error } = await pageOf(shown))
  }
  if (error) throw error
  return { data: (data ?? []) as unknown[], total: count ?? 0, page: shown }
}

/** How many In Progress requests the admin home lists. */
export const PENDING_LIMIT = 10

export interface PendingRequests {
  rows: AdminRequestRow[]
  /** Every In Progress request, not only the ones listed. */
  total: number
}

// The most recently submitted In Progress requests of every type, newest
// first (date, then time, then Request ID, as in the prototype), with the
// exact number of In Progress requests.
export async function fetchPendingRequests(): Promise<PendingRequests> {
  const { data, count, error } = await supabase
    .from('Request')
    .select(REQUEST_WITH_STUDENT, { count: 'exact' })
    .eq('Current_Status', IN_PROGRESS)
    .order('Request_Date', { ascending: false })
    .order('Submission_Time', { ascending: false })
    .order('Request_ID', { ascending: false })
    .range(0, PENDING_LIMIT - 1)
  if (error) throw error
  return { rows: ((data ?? []) as RequestWithStudent[]).map(toAdminRow), total: count ?? 0 }
}

// ---------------------------------------------------------------------------
// All Requests (/admin/requests): every type and status, filtered, sorted and
// paged in the database (utils/adminAllRequests.ts builds the filters).

export interface AllRequestsPage {
  rows: AdminRequestRow[]
  total: number
  /** The page shown (lower than requested if that page no longer exists). */
  page: number
}

// The Completed Incomplete Exam / Course Substitution / Course Equivalency
// requests with a matching approval decision (one read of the approval
// decisions with their request). Unlike the badges, a failure is an error:
// the Approved / Completed filters must never guess.
async function fetchApprovedRequestIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('Decision')
    .select('Request_ID, Decision_Type, Request(Request_Type, Current_Status)')
    .in('Decision_Type', Object.values(APPROVAL_DECISION_TYPES))
  if (error) throw error
  return approvedRequestIds((data ?? []) as unknown as ApprovalDecisionRow[])
}

async function studentIdsNamed(term: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('Student')
    .select('Student_ID')
    .ilike('Student_Name', `%${term}%`)
    .limit(200)
  if (error) throw error
  return ((data ?? []) as { Student_ID: unknown }[]).map((s) => str(s.Student_ID))
}

export async function fetchAllRequests(filters: AllRequestsFilters): Promise<AllRequestsPage> {
  const plan = statusPlan(filters.status)
  const term = searchTerm(filters.search)
  const [studentIds, approvedIds] = await Promise.all([
    term ? studentIdsNamed(term) : Promise.resolve([]),
    needsApprovalIds(plan) ? fetchApprovedRequestIds() : Promise.resolve([]),
  ])

  const groups: string[] = []
  if (term) groups.push(studentSearchGroup(term, studentIds))
  if (plan.kind === 'approved') groups.push(approvedGroup(approvedIds))
  const orFilter = combineOrGroups(groups)
  const excluded = plan.kind === 'unconfirmed' ? inList(approvedIds) : null
  const ascending = filters.sort === 'oldest'

  const build = () => {
    let query = supabase.from('Request').select(REQUEST_WITH_STUDENT, { count: 'exact' })
    if (filters.type) query = query.eq('Request_Type', filters.type)
    if (plan.kind !== 'any') query = query.eq('Current_Status', plan.stored)
    if (plan.kind === 'unconfirmed') {
      query = query.in('Request_Type', [...RECORDED_APPROVAL_TYPES])
      if (excluded) query = query.not('Request_ID', 'in', excluded)
    }
    if (filters.from) query = query.gte('Request_Date', filters.from)
    if (filters.to) query = query.lte('Request_Date', filters.to)
    if (orFilter) query = query.or(orFilter)
    return query
      .order('Request_Date', { ascending })
      .order('Submission_Time', { ascending })
      .order('Request_ID', { ascending })
  }

  const result = await fetchPage(build, filters.page, ALL_REQUESTS_PAGE_SIZE)
  return {
    rows: await withRecordedApprovals((result.data as RequestWithStudent[]).map(toAdminRow)),
    total: result.total,
    page: result.page,
  }
}

// ---------------------------------------------------------------------------
// Requests of one type: status counts, filtering, search and Course / Program

/** The statuses the database allows (request_status_check). */
export const REQUEST_STATUSES = [IN_PROGRESS, 'Completed', 'Rejected'] as const

export interface TypeStatusCounts {
  all: number
  byStatus: Record<string, number>
}

export async function fetchTypeStatusCounts(type: string): Promise<TypeStatusCounts> {
  const [all, ...perStatus] = await Promise.all([
    countRequests(type),
    ...REQUEST_STATUSES.map((status) => countRequests(type, status)),
  ])
  return {
    all,
    byStatus: Object.fromEntries(REQUEST_STATUSES.map((status, i) => [status, perStatus[i]])),
  }
}

export interface TypeRequestRow extends AdminRequestRow {
  /** Course / Program, from the type's detail table (null if unavailable). */
  target: string | null
}

export const TYPE_PAGE_SIZE = 10

/** How each type's detail table describes the course or program. */
const TYPE_DETAILS: Record<string, { table: string; columns: string }> = {
  'Raise Capacity': { table: 'Raise_Capacity', columns: 'Course_ID, Section_ID' },
  'Incomplete Exam': { table: 'Incomplete_Exam', columns: 'Course_ID, Section_ID' },
  'Course Substitution': {
    table: 'Course_Substitution',
    columns: 'Original_Course_ID, Proposed_Course_ID',
  },
  'Program Change': {
    table: 'Program_Change',
    columns: 'Current_Program_ID, Current_Program_Name, New_Program_ID, New_Program_Name',
  },
  'Course Equivalency': { table: 'Course_Equivalency', columns: 'Old_Course_ID, New_Course_ID' },
}

/** Types whose detail row names an original and a replacement course. */
const COURSE_PAIRS: Record<string, [string, string]> = {
  'Course Equivalency': ['Old_Course_ID', 'New_Course_ID'],
  'Course Substitution': ['Original_Course_ID', 'Proposed_Course_ID'],
}

type DetailRow = Record<string, string | number | null>

const str = (value: unknown) => (value == null ? '' : String(value).trim())

async function courseIdsMatching(pattern: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('Course')
    .select('Course_ID')
    .or(`Course_ID.ilike.${quoted(pattern)},Course_Name.ilike.${quoted(pattern)}`)
    .limit(200)
  if (error) throw error
  return ((data ?? []) as { Course_ID: string }[]).map((c) => str(c.Course_ID))
}

// Request IDs of this type whose course or program matches the search.
async function requestIdsByTarget(type: string, pattern: string): Promise<string[]> {
  const details = TYPE_DETAILS[type]
  if (!details) return []
  let query = supabase.from(details.table).select('Request_ID').limit(500)

  if (type === 'Program Change') {
    query = query.or(
      ['Current_Program_ID', 'Current_Program_Name', 'New_Program_ID', 'New_Program_Name']
        .map((column) => `${column}.ilike.${quoted(pattern)}`)
        .join(','),
    )
  } else {
    const courses = await courseIdsMatching(pattern)
    if (courses.length === 0) return []
    const list = `(${courses.map(quoted).join(',')})`
    const pair = COURSE_PAIRS[type]
    query = pair
      ? query.or(`${pair[0]}.in.${list},${pair[1]}.in.${list}`)
      : query.in('Course_ID', courses)
  }

  const { data, error } = await query
  if (error) throw error
  return ((data ?? []) as { Request_ID: string }[]).map((r) => str(r.Request_ID))
}

// Builds the OR filter for a search over Request ID, student ID, student
// name and Course / Program. Returns null for an empty search.
async function searchFilter(type: string, raw: string): Promise<string | null> {
  const term = searchTerm(raw)
  if (!term) return null
  const pattern = `%${term}%`

  const [students, requests] = await Promise.all([
    supabase.from('Student').select('Student_ID').ilike('Student_Name', pattern).limit(200),
    requestIdsByTarget(type, pattern),
  ])
  if (students.error) throw students.error
  const studentIds = ((students.data ?? []) as { Student_ID: string }[]).map((s) => str(s.Student_ID))

  const parts = [`Request_ID.ilike.${quoted(pattern)}`, `Student_ID.ilike.${quoted(pattern)}`]
  if (studentIds.length) parts.push(`Student_ID.in.(${studentIds.map(quoted).join(',')})`)
  if (requests.length) parts.push(`Request_ID.in.(${requests.map(quoted).join(',')})`)
  return parts.join(',')
}

function targetText(type: string, detail: DetailRow | null, courseNames: Map<string, string>) {
  if (!detail) return null
  const course = (id: unknown) => [str(id), courseNames.get(str(id))].filter(Boolean).join(' ')

  if (type === 'Program Change') {
    const from = str(detail.Current_Program_Name) || str(detail.Current_Program_ID)
    const to = str(detail.New_Program_Name) || str(detail.New_Program_ID)
    return [from, to].filter(Boolean).join(' → ') || null
  }
  const pair = COURSE_PAIRS[type]
  if (pair) {
    return [course(detail[pair[0]]), course(detail[pair[1]])].filter(Boolean).join(' → ') || null
  }
  const text = course(detail.Course_ID)
  if (!text) return null
  // The prototype's format: "COSC 330 Operating Systems · S02"
  return str(detail.Section_ID) ? `${text} · S${str(detail.Section_ID)}` : text
}

export interface TypeRequestsQuery {
  type: string
  status: string | null
  search: string
  page: number
}

// One page of a type's requests, newest first, with an exact total for the
// current status and search.
export async function fetchTypeRequests({ type, status, search, page }: TypeRequestsQuery): Promise<{
  rows: TypeRequestRow[]
  total: number
  /** The page shown (lower than requested if that page no longer exists). */
  page: number
}> {
  const details = TYPE_DETAILS[type]
  const filter = await searchFilter(type, search)

  const build = () => {
    let query = supabase
      .from('Request')
      .select(`${REQUEST_WITH_STUDENT}${details ? `, ${details.table}(${details.columns})` : ''}`, {
        count: 'exact',
      })
      .eq('Request_Type', type)
    if (status) query = query.eq('Current_Status', status)
    if (filter) query = query.or(filter)
    return query
      .order('Request_Date', { ascending: false })
      .order('Submission_Time', { ascending: false })
      .order('Request_ID', { ascending: false })
  }

  const result = await fetchPage(build, page, TYPE_PAGE_SIZE)
  const raw = result.data as (RequestWithStudent & Record<string, unknown>)[]
  const detailOf = (row: Record<string, unknown>): DetailRow | null => {
    if (!details) return null
    const value = row[details.table]
    const one = Array.isArray(value) ? value[0] : value
    return (one ?? null) as DetailRow | null
  }

  const courseIds = new Set<string>()
  for (const row of raw) {
    const detail = detailOf(row)
    for (const key of ['Course_ID', ...(COURSE_PAIRS[type] ?? [])]) {
      if (detail && str(detail[key])) courseIds.add(str(detail[key]))
    }
  }
  const courseNames = new Map<string, string>()
  if (courseIds.size) {
    const { data: courses, error: courseError } = await supabase
      .from('Course')
      .select('Course_ID, Course_Name')
      .in('Course_ID', [...courseIds])
    if (courseError) throw courseError
    for (const c of (courses ?? []) as { Course_ID: string; Course_Name: string }[]) {
      courseNames.set(str(c.Course_ID), str(c.Course_Name))
    }
  }

  return {
    rows: await withRecordedApprovals(
      raw.map((row) => ({ ...toAdminRow(row), target: targetText(type, detailOf(row), courseNames) })),
    ),
    total: result.total,
    page: result.page,
  }
}

// ---------------------------------------------------------------------------
// Search by exact student ID or request ID (admin home). The admin home
// opens the result's page directly; nothing is previewed.

export type SearchTarget =
  | { kind: 'student'; studentId: string }
  | { kind: 'request'; requestId: string; type: string }

/** The student or request with exactly this ID (already trimmed, upper-cased
 *  and classified by utils/adminSearch.ts), or null when none exists. Throws
 *  when it cannot be read, so a failure is never reported as "not found". */
export async function findSearchTarget(input: { kind: 'student' | 'request'; id: string }): Promise<SearchTarget | null> {
  if (input.kind === 'student') {
    const { data, error } = await supabase.from('Student').select('Student_ID').eq('Student_ID', input.id).maybeSingle()
    if (error) throw error
    return data ? { kind: 'student', studentId: String((data as { Student_ID: unknown }).Student_ID) } : null
  }
  const { data, error } = await supabase
    .from('Request')
    .select('Request_ID, Request_Type')
    .eq('Request_ID', input.id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as { Request_ID: unknown; Request_Type: unknown }
  return { kind: 'request', requestId: String(row.Request_ID), type: String(row.Request_Type) }
}

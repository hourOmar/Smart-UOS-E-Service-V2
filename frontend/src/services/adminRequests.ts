import { supabase } from './supabase'
import { academicRequestTypes } from '../data/academicRequests'

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
  }
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

export const PENDING_PAGE_SIZE = 6

export interface PendingPage {
  rows: AdminRequestRow[]
  total: number
  /** The page shown (lower than requested if that page no longer exists). */
  page: number
}

// One page of In Progress requests, newest first (as in the prototype),
// optionally of one type. The page is fetched from the database with an
// exact total, so paging works for any number of requests.
export async function fetchPendingRequests(type: string | null, page: number): Promise<PendingPage> {
  const build = () => {
    let query = supabase
      .from('Request')
      .select(REQUEST_WITH_STUDENT, { count: 'exact' })
      .eq('Current_Status', IN_PROGRESS)
    if (type) query = query.eq('Request_Type', type)
    return query
      .order('Request_Date', { ascending: false })
      .order('Submission_Time', { ascending: false })
      .order('Request_ID', { ascending: false })
  }

  const result = await fetchPage(build, page, PENDING_PAGE_SIZE)
  return {
    rows: (result.data as RequestWithStudent[]).map(toAdminRow),
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

// Characters that would break a PostgREST filter are removed; the rest is
// matched case-insensitively anywhere in the value.
function searchTerm(raw: string) {
  return raw.replace(/[^\p{L}\p{N} _.@-]/gu, ' ').replace(/\s+/g, ' ').trim()
}

const quoted = (value: string) => `"${value}"`

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
    rows: raw.map((row) => ({ ...toAdminRow(row), target: targetText(type, detailOf(row), courseNames) })),
    total: result.total,
    page: result.page,
  }
}

// ---------------------------------------------------------------------------
// Search by exact student ID or request ID

export interface StudentMatch {
  kind: 'student'
  studentId: string
  name: string | null
  email: string | null
  program: string | null
  totalRequests: number
  inProgress: number
}

export interface RequestMatch {
  kind: 'request'
  request: AdminRequestRow
  summary: string | null
}

export type SearchResult = StudentMatch | RequestMatch | null

async function countStudentRequests(studentId: string, status?: string) {
  let query = supabase
    .from('Request')
    .select('Request_ID', { count: 'exact', head: true })
    .eq('Student_ID', studentId)
  if (status) query = query.eq('Current_Status', status)
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

// IDs are stored in upper case (U21…, STUD_…), so the query is matched
// exactly after trimming and upper-casing. Returns null when nothing matches.
export async function searchStudentOrRequest(rawQuery: string): Promise<SearchResult> {
  const q = rawQuery.trim().toUpperCase()

  const [student, request] = await Promise.all([
    supabase
      .from('Student')
      .select('Student_ID, Student_Name, Student_Email, Program_ID, Program_Name')
      .eq('Student_ID', q)
      .maybeSingle(),
    supabase
      .from('Request')
      .select(`${REQUEST_WITH_STUDENT}, Description`)
      .eq('Request_ID', q)
      .maybeSingle(),
  ])
  if (student.error) throw student.error
  if (request.error) throw request.error

  if (student.data) {
    const s = student.data as {
      Student_ID: string
      Student_Name: string | null
      Student_Email: string | null
      Program_ID: string | null
      Program_Name: string | null
    }
    const [totalRequests, inProgress] = await Promise.all([
      countStudentRequests(s.Student_ID),
      countStudentRequests(s.Student_ID, IN_PROGRESS),
    ])
    return {
      kind: 'student',
      studentId: String(s.Student_ID),
      name: s.Student_Name?.trim() || null,
      email: s.Student_Email?.trim() || null,
      program: [s.Program_ID, s.Program_Name].filter(Boolean).join(' · ') || null,
      totalRequests,
      inProgress,
    }
  }

  if (request.data) {
    const r = request.data as unknown as RequestWithStudent & { Description: string | null }
    return { kind: 'request', request: toAdminRow(r), summary: r.Description?.trim() || null }
  }

  return null
}

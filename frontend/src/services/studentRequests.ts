import { supabase } from './supabase'

// Every query here runs with the signed-in student's session. The database
// policies return only that student's own requests and details, so another
// student's request is simply not found.

export interface StudentRequestRow {
  id: string
  type: string
  /** Request_Date (YYYY-MM-DD) */
  date: string
  status: string
}

export interface RequestField {
  label: string
  value: string
}

export interface StudentRequestDetails extends StudentRequestRow {
  /** Request.Description: the request summary. */
  summary: string | null
  /** Short subject for the heading, e.g. course code and name. */
  title: string | null
  fields: RequestField[]
  /** The student's own text (Reason column of the detail table). */
  reason: { label: string; text: string } | null
  /** Request_History, once a final decision has been recorded. */
  decision: { status: string; date: string } | null
}

interface RequestRowData {
  Request_ID: string
  Request_Type: string
  Request_Date: string
  Current_Status: string
}

const REQUEST_COLUMNS = 'Request_ID, Request_Type, Request_Date, Current_Status'

function toRow(row: RequestRowData): StudentRequestRow {
  return {
    id: row.Request_ID,
    type: row.Request_Type,
    date: row.Request_Date,
    status: row.Current_Status,
  }
}

// The signed-in student's requests, newest first (submission date and
// time, then Request_ID).
export async function fetchStudentRequests(limit?: number): Promise<StudentRequestRow[]> {
  let query = supabase
    .from('Request')
    .select(REQUEST_COLUMNS)
    .order('Request_Date', { ascending: false })
    .order('Submission_Time', { ascending: false })
    .order('Request_ID', { ascending: false })
  if (limit) query = query.limit(limit)

  const { data, error } = await query
  if (error) throw error
  return ((data ?? []) as RequestRowData[]).map(toRow)
}

// ---------------------------------------------------------------------------
// Formatting

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "2026-10-06" or a timestamp -> "Oct 6, 2026" (the prototype's format).
// The date part is read as written, so no time-zone shift can move it.
export function formatDate(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '')
  if (!match) return value ?? ''
  const [, year, month, day] = match
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`
}

// ---------------------------------------------------------------------------
// Details

const text = (value: unknown) => (value == null ? '' : String(value).trim())

async function courseNames(ids: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter(Boolean))]
  if (wanted.length === 0) return new Map()
  const { data, error } = await supabase
    .from('Course')
    .select('Course_ID, Course_Name')
    .in('Course_ID', wanted)
  if (error) throw error
  return new Map(
    ((data ?? []) as { Course_ID: string; Course_Name: string }[]).map((c) => [
      String(c.Course_ID),
      text(c.Course_Name),
    ]),
  )
}

const courseLabel = (id: string, names: Map<string, string>) =>
  [id, names.get(id)].filter(Boolean).join(' ')

const programLabel = (id: unknown, name: unknown) =>
  [text(id), text(name)].filter(Boolean).join(' · ')

function formatTime(value: unknown) {
  const match = /^(\d{2}):(\d{2})/.exec(text(value))
  return match ? `${match[1]}:${match[2]}` : text(value)
}

interface TypeDetails {
  title: string | null
  fields: RequestField[]
  reason: StudentRequestDetails['reason']
}

// Reads the saved information for one request from its type's table.
async function fetchTypeDetails(type: string, requestId: string): Promise<TypeDetails> {
  const one = async (table: string, columns: string) => {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq('Request_ID', requestId)
      .maybeSingle()
    if (error) throw error
    return (data ?? null) as Record<string, unknown> | null
  }
  const reasonOf = (row: Record<string, unknown>, label = 'Reason') =>
    text(row.Reason) ? { label, text: text(row.Reason) } : null

  switch (type) {
    case 'Raise Capacity': {
      const row = await one('Raise_Capacity', 'Course_ID, Section_ID, Term, Reason')
      if (!row) break
      const courseId = text(row.Course_ID)
      const names = await courseNames([courseId])
      return {
        title: courseLabel(courseId, names),
        fields: [
          { label: 'Course code', value: courseId },
          { label: 'Course name', value: names.get(courseId) ?? '' },
          { label: 'Section', value: text(row.Section_ID) },
          { label: 'Term', value: text(row.Term) },
        ],
        reason: reasonOf(row, 'Justification'),
      }
    }
    case 'Incomplete Exam': {
      const row = await one(
        'Incomplete_Exam',
        'Course_ID, Section_ID, Term, Exam_Type, Missed_Exam_Date, Missed_Exam_Time, Proof, Reason',
      )
      if (!row) break
      const courseId = text(row.Course_ID)
      const names = await courseNames([courseId])
      return {
        title: courseLabel(courseId, names),
        fields: [
          { label: 'Course code', value: courseId },
          { label: 'Course name', value: names.get(courseId) ?? '' },
          { label: 'Section', value: text(row.Section_ID) },
          { label: 'Term', value: text(row.Term) },
          { label: 'Exam type', value: text(row.Exam_Type) },
          { label: 'Missed exam date', value: formatDate(text(row.Missed_Exam_Date)) },
          { label: 'Missed exam time', value: formatTime(row.Missed_Exam_Time) },
          { label: 'Proof', value: text(row.Proof) },
        ],
        reason: reasonOf(row),
      }
    }
    case 'Course Substitution': {
      const row = await one('Course_Substitution', 'Original_Course_ID, Proposed_Course_ID, Reason')
      if (!row) break
      const originalId = text(row.Original_Course_ID)
      const proposedId = text(row.Proposed_Course_ID)
      const names = await courseNames([originalId, proposedId])
      return {
        title: [originalId, proposedId].filter(Boolean).join(' → ') || null,
        fields: [
          { label: 'Original course', value: courseLabel(originalId, names) },
          { label: 'Proposed course', value: courseLabel(proposedId, names) },
        ],
        reason: reasonOf(row),
      }
    }
    case 'Program Change': {
      const row = await one(
        'Program_Change',
        'Current_Program_ID, Current_Program_Name, New_Program_ID, New_Program_Name, Reason',
      )
      if (!row) break
      const from = text(row.Current_Program_Name) || text(row.Current_Program_ID)
      const to = text(row.New_Program_Name) || text(row.New_Program_ID)
      return {
        title: [from, to].filter(Boolean).join(' → ') || null,
        fields: [
          { label: 'Current program', value: programLabel(row.Current_Program_ID, row.Current_Program_Name) },
          { label: 'Requested program', value: programLabel(row.New_Program_ID, row.New_Program_Name) },
        ],
        reason: reasonOf(row),
      }
    }
    case 'Course Equivalency': {
      const row = await one('Course_Equivalency', 'Old_Course_ID, New_Course_ID, Reason')
      if (!row) break
      const oldId = text(row.Old_Course_ID)
      const newId = text(row.New_Course_ID)
      const names = await courseNames([oldId, newId])
      return {
        title: [oldId, newId].filter(Boolean).join(' → ') || null,
        fields: [
          { label: 'Course taken', value: courseLabel(oldId, names) },
          { label: 'Equivalent course', value: courseLabel(newId, names) },
        ],
        reason: reasonOf(row),
      }
    }
  }
  return { title: null, fields: [], reason: null }
}

// One request with its saved details, or null when it does not exist or
// belongs to someone else (the database returns nothing in both cases).
export async function fetchStudentRequestDetails(
  requestId: string,
): Promise<StudentRequestDetails | null> {
  const { data, error } = await supabase
    .from('Request')
    .select(`${REQUEST_COLUMNS}, Description`)
    .eq('Request_ID', requestId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as RequestRowData & { Description: string | null }
  const [details, history] = await Promise.all([
    fetchTypeDetails(row.Request_Type, row.Request_ID),
    supabase
      .from('Request_History')
      .select('Final_Status, Completion_Date')
      .eq('Request_ID', row.Request_ID)
      .maybeSingle(),
  ])
  if (history.error) throw history.error
  const decision = history.data as { Final_Status: string; Completion_Date: string } | null

  return {
    ...toRow(row),
    summary: text(row.Description) || null,
    title: details.title,
    fields: details.fields.filter((field) => field.value !== ''),
    reason: details.reason,
    decision: decision
      ? { status: decision.Final_Status, date: decision.Completion_Date }
      : null,
  }
}

// ---------------------------------------------------------------------------
// Reason for a rejected Raise Capacity request

export interface RejectionReason {
  /** The staff member's saved explanation; null when none was recorded. */
  explanation: string | null
}

// The explanation staff saved when rejecting the signed-in student's own Raise
// Capacity request (database function get_my_raise_capacity_rejection, which
// returns nothing for any other request). Throws when it cannot be loaded, so a
// loading failure is never shown as "no explanation".
export async function fetchRejectionReason(requestId: string): Promise<RejectionReason> {
  const { data, error } = await supabase.rpc('get_my_raise_capacity_rejection', { p_request_id: requestId })
  if (error) throw error
  const body = data as { has_decision_record?: boolean; explanation?: string | null } | null
  return { explanation: body?.has_decision_record ? text(body.explanation) || null : null }
}

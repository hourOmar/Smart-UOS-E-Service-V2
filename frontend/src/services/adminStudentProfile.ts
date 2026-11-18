import { supabase } from './supabase'
import { APPROVAL_DECISION_TYPES, needsApprovalRecord, recordedApprovalIds } from '../utils/statusLabels'
import type { HistoryRequest, TranscriptEntry } from '../utils/studentProfile'

// The admin Student Profile: one student's record, transcript and every
// request, read with the signed-in staff member's own session. The database
// policies decide what may be read (staff_read_students, the staff policy on
// Takes, staff_read_requests, staff_read_request_history,
// staff_read_decisions); a student or anyone else gets nothing back. Nothing
// is written and nothing is recalculated.

export interface AdminStudent {
  id: string
  name: string | null
  email: string | null
  programId: string | null
  programName: string | null
  college: string | null
  /** As stored on the Student record. */
  cgpa: number | null
  completedHours: number | null
  expectedGraduationTerm: number | null
}

/** One part of the page, loaded independently: a failure in one part is
 *  reported there, never shown as "no records". */
export type ProfilePart<T> = { status: 'ready'; data: T } | { status: 'error' }

export interface RequestHistoryData {
  /** Every Request row of the student, whatever its type or details. */
  rows: HistoryRequest[]
  /** False when the approval decision records could not be read: Completed
   *  Incomplete Exam / Course Substitution requests then keep 'Completed'. */
  approvalsKnown: boolean
}

export interface AdminStudentProfile {
  student: AdminStudent
  transcript: ProfilePart<TranscriptEntry[]>
  requests: ProfilePart<RequestHistoryData>
}

const text = (value: unknown) => {
  const trimmed = value == null ? '' : String(value).trim()
  return trimmed === '' ? null : trimmed
}
const num = (value: unknown) => (value == null || value === '' || Number.isNaN(Number(value)) ? null : Number(value))

async function settle<T>(load: () => Promise<T>): Promise<ProfilePart<T>> {
  try {
    return { status: 'ready', data: await load() }
  } catch {
    return { status: 'error' }
  }
}

/** Every Takes row of one student, with course names and credit hours.
 *  Read with the caller's session, so RLS decides what comes back: staff
 *  ("Staff can view academic records") or the student themself ("Students
 *  can view own academic records"). Also used by the student's My Profile
 *  (hooks/useStudentTranscript.ts). */
export async function loadTranscript(studentId: string): Promise<TranscriptEntry[]> {
  const takes = await supabase.from('Takes').select('Course_ID, Section_ID, Term, Grade').eq('Student_ID', studentId)
  if (takes.error) throw takes.error
  const rows = (takes.data ?? []) as { Course_ID: unknown; Section_ID: unknown; Term: unknown; Grade: unknown }[]

  const courseIds = [...new Set(rows.map((r) => String(r.Course_ID)))]
  const courses = new Map<string, { name: string | null; creditHours: number | null }>()
  if (courseIds.length > 0) {
    const result = await supabase.from('Course').select('Course_ID, Course_Name, Credit_Hours').in('Course_ID', courseIds)
    if (result.error) throw result.error
    for (const c of (result.data ?? []) as { Course_ID: unknown; Course_Name: unknown; Credit_Hours: unknown }[]) {
      courses.set(String(c.Course_ID), { name: text(c.Course_Name), creditHours: num(c.Credit_Hours) })
    }
  }

  return rows.map((r) => {
    const course = courses.get(String(r.Course_ID))
    return {
      courseId: String(r.Course_ID),
      courseName: course?.name ?? null,
      creditHours: course?.creditHours ?? null,
      term: Number(r.Term),
      sectionId: text(r.Section_ID),
      grade: text(r.Grade),
    }
  })
}

async function loadRequests(studentId: string): Promise<RequestHistoryData> {
  const requests = await supabase
    .from('Request')
    .select('Request_ID, Request_Type, Request_Date, Submission_Time, Current_Status')
    .eq('Student_ID', studentId)
  if (requests.error) throw requests.error
  const base = ((requests.data ?? []) as {
    Request_ID: unknown
    Request_Type: unknown
    Request_Date: unknown
    Submission_Time: unknown
    Current_Status: unknown
  }[]).map((r) => ({
    id: String(r.Request_ID),
    type: String(r.Request_Type),
    date: text(r.Request_Date),
    time: text(r.Submission_Time),
    status: String(r.Current_Status),
  }))
  if (base.length === 0) return { rows: [], approvalsKnown: true }
  const ids = base.map((r) => r.id)

  // The decision date of decided requests (the date every other page shows).
  const history = await supabase.from('Request_History').select('Request_ID, Completion_Date').in('Request_ID', ids)
  if (history.error) throw history.error
  const decidedAt = new Map<string, string>()
  for (const h of (history.data ?? []) as { Request_ID: unknown; Completion_Date: unknown }[]) {
    const date = text(h.Completion_Date)
    const id = String(h.Request_ID)
    if (date && (!decidedAt.has(id) || date > (decidedAt.get(id) ?? ''))) decidedAt.set(id, date)
  }

  // Recorded approvals, only for the Completed requests whose label needs one
  // (statusLabels.ts). An unreadable Decision keeps those as 'Completed'.
  const needed = base.filter((r) => needsApprovalRecord(r.status, r.type))
  let approved = new Set<string>()
  let approvalsKnown = true
  if (needed.length > 0) {
    const decisions = await supabase
      .from('Decision')
      .select('Request_ID, Decision_Type')
      .in('Request_ID', needed.map((r) => r.id))
      .in('Decision_Type', Object.values(APPROVAL_DECISION_TYPES))
    if (decisions.error) {
      approvalsKnown = false
    } else {
      approved = recordedApprovalIds(
        needed,
        ((decisions.data ?? []) as { Request_ID: unknown; Decision_Type: unknown }[]).map((d) => ({
          requestId: String(d.Request_ID),
          decisionType: String(d.Decision_Type),
        })),
      )
    }
  }

  return {
    rows: base.map((r) => ({
      ...r,
      approvalRecorded: approved.has(r.id),
      decidedAt: r.status === 'In Progress' ? null : (decidedAt.get(r.id) ?? null),
    })),
    approvalsKnown,
  }
}

/** Null when no student has this ID (or the caller may not read it).
 *  Throws when the student record cannot be read. */
export async function fetchAdminStudentProfile(studentId: string): Promise<AdminStudentProfile | null> {
  const { data, error } = await supabase
    .from('Student')
    .select(
      'Student_ID, Student_Name, Student_Email, CGPA, Completed_Hours, Program_ID, Program_Name, Expected_Graduation_Term, Program(College_Name)',
    )
    .eq('Student_ID', studentId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const s = data as Record<string, unknown> & {
    Program: { College_Name: unknown } | { College_Name: unknown }[] | null
  }
  const program = Array.isArray(s.Program) ? s.Program[0] : s.Program
  const id = String(s.Student_ID)

  const [transcript, requests] = await Promise.all([settle(() => loadTranscript(id)), settle(() => loadRequests(id))])

  return {
    student: {
      id,
      name: text(s.Student_Name),
      email: text(s.Student_Email),
      programId: text(s.Program_ID),
      programName: text(s.Program_Name),
      college: text(program?.College_Name),
      cgpa: num(s.CGPA),
      completedHours: num(s.Completed_Hours),
      expectedGraduationTerm: num(s.Expected_Graduation_Term),
    },
    transcript,
    requests,
  }
}

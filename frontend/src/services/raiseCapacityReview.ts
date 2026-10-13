import { ApiError, callBackend } from './backendApi'
import { supabase } from './supabase'

// Staff review of one Raise Capacity request, from two independent sources:
// - the request, student and transcript are read from Supabase with the staff
//   member's own session (staff may read them under the database policies);
// - the eligibility evaluation comes from the backend's staff-only endpoints,
//   authorized with the same session's access token. No credential other than
//   that token ever leaves the browser.

// ---------------------------------------------------------------------------
// Request, student and transcript (current data)

export interface ReviewRequest {
  id: string
  type: string
  status: string
  date: string | null
  time: string | null
  summary: string | null
  studentId: string
  /** Null when the request has no Raise_Capacity row. */
  details: {
    courseId: string
    courseName: string | null
    sectionId: string
    term: number
    justification: string | null
  } | null
}

export interface ReviewStudent {
  id: string
  name: string | null
  email: string | null
  program: string | null
  college: string | null
  cgpa: number | null
  completedHours: number | null
  expectedGraduationTerm: number | null
}

export interface TranscriptRow {
  courseId: string
  courseName: string | null
  grade: string | null
  term: number | null
  sectionId: string | null
}

/** The staff decision saved by decide_raise_capacity_request. */
export interface SavedDecision {
  id: number
  choice: DecisionChoice
  explanation: string
  staffId: number
  /** Only readable for the signed-in staff member's own decisions. */
  staffName: string | null
  /** ISO timestamp (UTC). */
  date: string | null
}

/** Request_History row, for requests finalized without a Decision record. */
export interface FinalRecord {
  status: string
  staffId: number | null
  date: string | null
}

export interface ReviewRecord {
  request: ReviewRequest
  /** Null when the student's record cannot be found. */
  student: ReviewStudent | null
  transcript: TranscriptRow[]
  decision: SavedDecision | null
  history: FinalRecord | null
}

export type DecisionChoice = 'approve' | 'reject'

export const DECISION_TYPES: Record<DecisionChoice, string> = {
  approve: 'Raise Capacity Approved',
  reject: 'Raise Capacity Rejected',
}

/** Timestamps stored without a time zone are UTC (the database clock). */
const utc = (value: unknown) => {
  const raw = text(value)
  if (!raw) return null
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`
}

const text = (value: unknown) => {
  const trimmed = value == null ? '' : String(value).trim()
  return trimmed === '' ? null : trimmed
}

/** Course names for the given IDs (current Course table). */
export async function courseNames(ids: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter(Boolean))]
  if (wanted.length === 0) return new Map()
  const { data, error } = await supabase.from('Course').select('Course_ID, Course_Name').in('Course_ID', wanted)
  if (error) throw error
  return new Map(
    ((data ?? []) as { Course_ID: string; Course_Name: string | null }[]).map((c) => [
      String(c.Course_ID),
      text(c.Course_Name) ?? '',
    ]),
  )
}

export type RecordResult =
  | { kind: 'found'; record: ReviewRecord }
  | { kind: 'not-found' }
  | { kind: 'other-type'; type: string }

export async function fetchReviewRecord(requestId: string): Promise<RecordResult> {
  const { data: request, error } = await supabase
    .from('Request')
    .select('Request_ID, Request_Type, Request_Date, Submission_Time, Current_Status, Description, Student_ID')
    .eq('Request_ID', requestId)
    .maybeSingle()
  if (error) throw error
  if (!request) return { kind: 'not-found' }
  if (request.Request_Type !== 'Raise Capacity') return { kind: 'other-type', type: request.Request_Type }

  const studentId = String(request.Student_ID)
  const [rc, student, takes, decision, history] = await Promise.all([
    supabase.from('Raise_Capacity').select('Course_ID, Section_ID, Term, Reason').eq('Request_ID', requestId).maybeSingle(),
    supabase
      .from('Student')
      .select(
        'Student_ID, Student_Name, Student_Email, CGPA, Completed_Hours, Program_ID, Program_Name, Expected_Graduation_Term, Program(College_Name)',
      )
      .eq('Student_ID', studentId)
      .maybeSingle(),
    supabase.from('Takes').select('Course_ID, Section_ID, Term, Grade').eq('Student_ID', studentId),
    supabase
      .from('Decision')
      .select('Decision_ID, Decision_Type, Decision_Comment, Decision_Date, Staff_ID, Authorized_Staff(Staff_Name)')
      .eq('Request_ID', requestId)
      .in('Decision_Type', Object.values(DECISION_TYPES))
      .order('Decision_Date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('Request_History').select('Final_Status, Completion_Date, Staff_ID').eq('Request_ID', requestId).maybeSingle(),
  ])
  if (rc.error) throw rc.error
  if (student.error) throw student.error
  if (takes.error) throw takes.error
  if (decision.error) throw decision.error
  if (history.error) throw history.error

  const d = decision.data as
    | (Record<string, unknown> & { Authorized_Staff: { Staff_Name: string | null } | { Staff_Name: string | null }[] | null })
    | null
  const decider = d ? (Array.isArray(d.Authorized_Staff) ? d.Authorized_Staff[0] : d.Authorized_Staff) : null
  const h = history.data as { Final_Status: string; Completion_Date: string | null; Staff_ID: number | null } | null

  const takesRows = (takes.data ?? []) as { Course_ID: string; Section_ID: string; Term: number; Grade: string | null }[]
  const names = await courseNames([...(rc.data ? [String(rc.data.Course_ID)] : []), ...takesRows.map((t) => String(t.Course_ID))])

  const s = student.data as
    | (Record<string, unknown> & { Program: { College_Name: string | null } | { College_Name: string | null }[] | null })
    | null
  const program = s ? (Array.isArray(s.Program) ? s.Program[0] : s.Program) : null

  return {
    kind: 'found',
    record: {
      request: {
        id: request.Request_ID,
        type: request.Request_Type,
        status: request.Current_Status,
        date: text(request.Request_Date),
        time: text(request.Submission_Time),
        summary: text(request.Description),
        studentId,
        details: rc.data
          ? {
              courseId: String(rc.data.Course_ID),
              courseName: names.get(String(rc.data.Course_ID)) || null,
              sectionId: String(rc.data.Section_ID),
              term: Number(rc.data.Term),
              justification: text(rc.data.Reason),
            }
          : null,
      },
      student: s
        ? {
            id: String(s.Student_ID),
            name: text(s.Student_Name),
            email: text(s.Student_Email),
            program: text(s.Program_Name) ?? text(s.Program_ID),
            college: text(program?.College_Name),
            cgpa: s.CGPA == null ? null : Number(s.CGPA),
            completedHours: s.Completed_Hours == null ? null : Number(s.Completed_Hours),
            expectedGraduationTerm: s.Expected_Graduation_Term == null ? null : Number(s.Expected_Graduation_Term),
          }
        : null,
      transcript: takesRows
        .map((t) => ({
          courseId: String(t.Course_ID),
          courseName: names.get(String(t.Course_ID)) || null,
          grade: text(t.Grade),
          term: t.Term == null ? null : Number(t.Term),
          sectionId: text(t.Section_ID),
        }))
        .sort((a, b) => (a.term ?? 0) - (b.term ?? 0) || a.courseId.localeCompare(b.courseId)),
      decision: d
        ? {
            id: Number(d.Decision_ID),
            choice: d.Decision_Type === DECISION_TYPES.approve ? 'approve' : 'reject',
            explanation: String(d.Decision_Comment ?? ''),
            staffId: Number(d.Staff_ID),
            staffName: text(decider?.Staff_Name),
            date: utc(d.Decision_Date),
          }
        : null,
      history: h
        ? { status: h.Final_Status, staffId: h.Staff_ID == null ? null : Number(h.Staff_ID), date: utc(h.Completion_Date) }
        : null,
    },
  }
}

// ---------------------------------------------------------------------------
// Staff decision (database function, signed-in staff session)

/** Refusals raised by decide_raise_capacity_request, in staff-facing words. */
const DECISION_MESSAGES: Record<string, string> = {
  not_staff: 'Only staff members linked in Authorized_Staff can decide requests.',
  invalid_decision: 'Choose Approve or Reject.',
  explanation_required: 'Enter an explanation for the decision.',
  explanation_too_long: 'The explanation can be at most 2,000 characters.',
  request_not_found: 'This request no longer exists.',
  not_raise_capacity: 'Only Raise Capacity requests can be decided here.',
  already_decided: 'This request has already been decided. The saved decision is shown below.',
  raise_capacity_details_missing: 'This request has no Raise Capacity details, so it cannot be decided.',
  section_not_found: 'The requested section no longer exists, so no seat can be allocated. Nothing was saved.',
  no_capacity:
    'No seat is left in this section: enrolled has reached total plus additional capacity. Nothing was saved.',
}

export class DecisionError extends Error {
  /** The database's refusal code (e.g. no_capacity), or 'unknown'. */
  readonly reason: string

  constructor(reason: string, message: string) {
    super(message)
    this.reason = reason
  }
}

export interface DecisionResult {
  status: string
  currentCapacity: number | null
}

export async function decideRaiseCapacityRequest(
  requestId: string,
  choice: DecisionChoice,
  explanation: string,
): Promise<DecisionResult> {
  let result
  try {
    result = await supabase.rpc('decide_raise_capacity_request', {
      p_request_id: requestId,
      p_decision: choice,
      p_explanation: explanation,
    })
  } catch {
    throw new DecisionError(
      'unknown',
      'The connection failed before the result was known. The page has been refreshed to show the current state.',
    )
  }
  const { data, error } = result
  if (error) {
    const reason = typeof error.message === 'string' && error.message in DECISION_MESSAGES ? error.message : 'unknown'
    throw new DecisionError(
      reason,
      DECISION_MESSAGES[reason] ??
        'The decision could not be saved. The page has been refreshed to show the current state.',
    )
  }
  const body = (data ?? {}) as { status?: string; current_capacity?: number | null }
  return { status: String(body.status ?? ''), currentCapacity: body.current_capacity ?? null }
}

// ---------------------------------------------------------------------------
// Eligibility evaluation (backend)

export type Recommendation = 'APPROVE' | 'REJECT' | 'MANUAL_REVIEW'

/** One stored run, exactly as the backend returns it. Evidence is a snapshot
 *  taken at evaluation time. */
export interface EvaluationRun {
  id: number
  run_status: 'running' | 'completed' | 'failed' | 'interrupted'
  trigger: 'first_open' | 'rerun'
  started_at: string | null
  evaluated_at: string | null
  recommendation: Recommendation | null
  reasoning: string | null
  check_explanations: { prerequisite?: string; completed_hours?: string; capacity?: string } | null
  evidence: EvaluationEvidence | null
  gemini_status: 'ok' | 'unavailable' | null
  gemini_error: string | null
  model: string | null
  agent_version: string | null
  error_message: string | null
}

export interface EvaluationEvidence {
  collected_at?: string
  course?: { Course_ID: string; Course_Name: string | null }
  section_id?: string
  term?: number
  checks: {
    prerequisite: {
      raw_prerequisite_text: string | null
      relationship_type: string | null
      is_pre_or_co: boolean | null
      required_prerequisite_groups: number[][] | null
      additional_text_conditions: string[] | null
      passed_courses: number[] | null
      failed_or_incomplete_courses: number[] | null
      never_attempted: number[] | null
      unresolved_grade_courses: number[] | null
      satisfied: boolean | null
      verified: boolean | null
      source_url: string | null
      source_scope: string | null
      details: string | null
    }
    completed_hours: {
      applicable: boolean
      verified?: boolean
      satisfied: boolean | null
      student_completed_hours: number | null
      required_hours: number | null
      required_standing?: string | null
      details?: string
    }
    capacity: {
      current_capacity: number
      total_capacity: number
      additional_capacity: number
      maximum_allowed_capacity: number
      remaining_raise_capacity: number
      satisfied: boolean
    }
  }
}

export interface EvaluationState {
  /** Newest successful result (a Gemini decision when one exists). */
  current: EvaluationRun | null
  /** A newer attempt that is not `current`: failed, interrupted, running or
   *  without a Gemini decision. */
  latest_attempt: EvaluationRun | null
  in_progress: boolean
  run_count: number
  started_by_this_call?: boolean
}

export { ApiError }

async function callApi(path: string, init?: RequestInit): Promise<EvaluationState> {
  const body = await callBackend<{ evaluation: EvaluationState }>(path, init, {
    service: 'eligibility service',
    byStatus: {
      404: 'The eligibility service could not find this Raise Capacity request.',
      409: 'An eligibility check is already running for this request.',
    },
  })
  return body.evaluation
}

const reviewPath = (requestId: string) => `/api/staff/raise-capacity/${encodeURIComponent(requestId)}`

/** The saved evaluation state. Never runs the agent. */
export function fetchEvaluation(requestId: string): Promise<EvaluationState> {
  return callApi(`${reviewPath(requestId)}/review`)
}

/** rerun=false runs only when the request has never been evaluated (first
 *  opening); rerun=true runs again. */
export function requestEvaluation(requestId: string, rerun: boolean): Promise<EvaluationState> {
  return callApi(`${reviewPath(requestId)}/evaluations`, { method: 'POST', body: JSON.stringify({ rerun }) })
}

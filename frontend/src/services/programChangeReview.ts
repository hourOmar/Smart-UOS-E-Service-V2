import { ApiError, callBackend } from './backendApi'
import { supabase } from './supabase'
import type { FinalRecord, ReviewStudent } from './raiseCapacityReview'
import {
  CONNECTION_DECISION_MESSAGE,
  decisionErrorCode,
  decisionErrorMessage,
  type DecisionChoice,
} from '../utils/programChangeDecision'

// Staff review of one Program Change request, from two independent sources
// (as for Raise Capacity):
// - the request, its Program_Change row and the student are read from
//   Supabase with the staff member's own session (database policies allow
//   staff to read them);
// - the eligibility evaluation comes from the backend's staff-only endpoints
//   (/api/staff/program-change/...), authorized with that session's token.
// - the final decision is recorded only through decide_program_change_request.

// ---------------------------------------------------------------------------
// Request and student (current data)

export interface ProgramRef {
  id: string | null
  name: string | null
}

export interface ProgramChangeReviewRequest {
  id: string
  type: string
  status: string
  date: string | null
  time: string | null
  summary: string | null
  studentId: string
  /** Null when the request has no Program_Change row. */
  details: {
    currentProgram: ProgramRef
    newProgram: ProgramRef
    reason: string | null
  } | null
}

/** The administrator decision saved by decide_program_change_request. */
export interface ProgramChangeDecision {
  id: number
  choice: DecisionChoice
  explanation: string
  staffId: number
  /** Only readable for the signed-in staff member's own decisions. */
  staffName: string | null
  /** ISO timestamp (UTC). */
  date: string | null
}

export interface ProgramChangeReviewRecord {
  request: ProgramChangeReviewRequest
  /** Null when the student's record cannot be found. */
  student: ReviewStudent | null
  decision: ProgramChangeDecision | null
  /** Request_History row, for a request finalized without a decision record. */
  history: FinalRecord | null
}

export const PROGRAM_CHANGE_DECISION_TYPES: Record<DecisionChoice, string> = {
  approve: 'Program Change Approved',
  reject: 'Program Change Rejected',
}

/** Timestamps stored without a time zone are UTC (the database clock). */
const utc = (value: unknown) => {
  const raw = text(value)
  if (!raw) return null
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`
}

export type ProgramChangeRecordResult =
  | { kind: 'found'; record: ProgramChangeReviewRecord }
  | { kind: 'not-found' }
  | { kind: 'other-type'; type: string }

const text = (value: unknown) => {
  const trimmed = value == null ? '' : String(value).trim()
  return trimmed === '' ? null : trimmed
}

/** "Computer Science (0402)", the name alone, or the ID alone. */
export function programLabel(program: ProgramRef | null | undefined) {
  if (!program) return null
  if (program.name && program.id) return `${program.name} (${program.id})`
  return program.name ?? program.id
}

export async function fetchProgramChangeReviewRecord(requestId: string): Promise<ProgramChangeRecordResult> {
  const { data: request, error } = await supabase
    .from('Request')
    .select('Request_ID, Request_Type, Request_Date, Submission_Time, Current_Status, Description, Student_ID')
    .eq('Request_ID', requestId)
    .maybeSingle()
  if (error) throw error
  if (!request) return { kind: 'not-found' }
  if (request.Request_Type !== 'Program Change') return { kind: 'other-type', type: request.Request_Type }

  const studentId = String(request.Student_ID)
  const [pc, student, decision, history] = await Promise.all([
    supabase
      .from('Program_Change')
      .select('Current_Program_ID, Current_Program_Name, New_Program_ID, New_Program_Name, Reason')
      .eq('Request_ID', requestId)
      .maybeSingle(),
    supabase
      .from('Student')
      .select(
        'Student_ID, Student_Name, Student_Email, CGPA, Completed_Hours, Program_ID, Program_Name, Expected_Graduation_Term, Program(College_Name)',
      )
      .eq('Student_ID', studentId)
      .maybeSingle(),
    supabase
      .from('Decision')
      .select('Decision_ID, Decision_Type, Decision_Comment, Decision_Date, Staff_ID, Authorized_Staff(Staff_Name)')
      .eq('Request_ID', requestId)
      .in('Decision_Type', Object.values(PROGRAM_CHANGE_DECISION_TYPES))
      .order('Decision_Date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('Request_History').select('Final_Status, Completion_Date, Staff_ID').eq('Request_ID', requestId).maybeSingle(),
  ])
  if (pc.error) throw pc.error
  if (student.error) throw student.error
  if (decision.error) throw decision.error
  if (history.error) throw history.error

  const d = decision.data as
    | (Record<string, unknown> & { Authorized_Staff: { Staff_Name: string | null } | { Staff_Name: string | null }[] | null })
    | null
  const decider = d ? (Array.isArray(d.Authorized_Staff) ? d.Authorized_Staff[0] : d.Authorized_Staff) : null
  const h = history.data as { Final_Status: string; Completion_Date: string | null; Staff_ID: number | null } | null

  const s = student.data as
    | (Record<string, unknown> & { Program: { College_Name: string | null } | { College_Name: string | null }[] | null })
    | null
  const program = s ? (Array.isArray(s.Program) ? s.Program[0] : s.Program) : null
  const row = pc.data as Record<string, unknown> | null

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
        details: row
          ? {
              currentProgram: { id: text(row.Current_Program_ID), name: text(row.Current_Program_Name) },
              newProgram: { id: text(row.New_Program_ID), name: text(row.New_Program_Name) },
              reason: text(row.Reason),
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
      decision: d
        ? {
            id: Number(d.Decision_ID),
            choice: d.Decision_Type === PROGRAM_CHANGE_DECISION_TYPES.approve ? 'approve' : 'reject',
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
// Administrator final decision (database function, signed-in staff session).
// The staff member is identified by the database from the session; nothing
// here sends a staff ID. Approval never changes the student's program.

export class ProgramChangeDecisionError extends Error {
  /** The database's refusal code (e.g. already_decided), or 'unknown'. */
  readonly reason: string

  constructor(reason: string, message: string) {
    super(message)
    this.name = 'ProgramChangeDecisionError'
    this.reason = reason
  }
}

export interface ProgramChangeDecisionResult {
  status: string
  decisionId: number | null
}

export async function decideProgramChangeRequest(
  requestId: string,
  choice: DecisionChoice,
  explanation: string,
): Promise<ProgramChangeDecisionResult> {
  let result
  try {
    result = await supabase.rpc('decide_program_change_request', {
      p_request_id: requestId,
      p_decision: choice,
      p_explanation: explanation.trim(),
    })
  } catch {
    throw new ProgramChangeDecisionError('unknown', CONNECTION_DECISION_MESSAGE)
  }
  const { data, error } = result
  if (error) {
    const reason = decisionErrorCode(error)
    throw new ProgramChangeDecisionError(reason, decisionErrorMessage(reason))
  }
  const body = (data ?? {}) as { status?: string; decision_id?: number | null }
  return { status: String(body.status ?? ''), decisionId: body.decision_id ?? null }
}

// ---------------------------------------------------------------------------
// Eligibility evaluation (backend), exactly as the API returns it

export type ProgramChangeRecommendation = 'APPROVE' | 'REJECT' | 'REQUIRES_REVIEW'

/** The agent's deterministic checks (eligibility_checks.run_basic_checks). */
export interface DeterministicResults {
  cgpa: number | string | null
  cgpa_eligible: boolean | null
  completed_hours: number | null
  applicable_hours: number | null
  matched_courses: {
    course_id: string
    course_name: string | null
    credit_hours: number | null
    grade?: string | null
  }[] | null
  /** Agent 1.1.0 onward only. */
  min_cgpa?: number
  min_applicable_hours?: number
  applicable_hours_eligible?: boolean
}

/** One academic check exactly as stored with the run. */
export interface EligibilityCheck {
  value: number | string | null
  /** Null when the run predates structured results. */
  minimum: number | null
  /** Null when no result was recorded. */
  passed: boolean | null
}

/** The backend's structured view of the stored deterministic results. */
export interface EligibilityView {
  /** False for runs evaluated before structured results were recorded. */
  recorded: boolean
  cgpa: EligibilityCheck
  applicable_hours: EligibilityCheck
  completed_hours: number | null
  /** APPROVE while a recorded check failed. */
  recommendation_conflict: boolean
}

export interface ProgramChangeRun {
  id: number
  run_status: 'running' | 'completed' | 'failed' | 'interrupted'
  trigger: 'first_open' | 'rerun'
  started_at: string | null
  finished_at: string | null
  /** Only on completed runs. */
  recommendation: ProgramChangeRecommendation | null
  /** Gemini's academic assessment (plain text with fixed headings). */
  report: string | null
  deterministic_results: DeterministicResults | null
  /** Null for runs without stored results (running or failed). */
  eligibility: EligibilityView | null
  study_plan_model: string | null
  assessment_model: string | null
  agent_version: string | null
  failure_kind: 'data' | 'technical' | 'interrupted' | null
  error_message: string | null
}

export interface ProgramChangeEvaluationState {
  request_id: string
  request_status: string
  /** Newest completed run. */
  current: ProgramChangeRun | null
  /** A newer attempt that is not `current` (failed, interrupted or running). */
  latest_attempt: ProgramChangeRun | null
  in_progress: boolean
  run_count: number
  /** Never evaluated and In Progress: the first evaluation may start. */
  auto_run_eligible: boolean
  /** In Progress and nothing running: a re-run is allowed. */
  can_rerun: boolean
  started_by_this_call?: boolean
  outcome?: string
}

export { ApiError }

async function callApi(path: string, init?: RequestInit): Promise<ProgramChangeEvaluationState> {
  const body = await callBackend<{ evaluation: ProgramChangeEvaluationState }>(path, init, {
    service: 'Program Change evaluation service',
    byStatus: {
      404: 'The evaluation service could not find this Program Change request.',
      // Either another check is running, or the request is no longer In
      // Progress; the state reloaded afterwards shows which.
      409: 'The evaluation could not be started now: a check is already running, or the request is no longer In Progress.',
    },
  })
  return body.evaluation
}

const reviewPath = (requestId: string) => `/api/staff/program-change/${encodeURIComponent(requestId)}`

/** The saved evaluation state. Never runs the agent. */
export function fetchProgramChangeEvaluation(requestId: string): Promise<ProgramChangeEvaluationState> {
  return callApi(`${reviewPath(requestId)}/evaluation`)
}

/** rerun=false: first evaluation (the backend runs it only when the request
 *  was never evaluated and is In Progress); rerun=true: evaluate again. */
export function requestProgramChangeEvaluation(requestId: string, rerun: boolean): Promise<ProgramChangeEvaluationState> {
  return callApi(`${reviewPath(requestId)}/evaluations`, { method: 'POST', body: JSON.stringify({ rerun }) })
}

// ---------------------------------------------------------------------------
// The agent's report, split into its headings for display text only (the
// summary and the issues). Eligibility thresholds and results come from the
// structured `eligibility` view, never from the report. Nothing is reworded:
// each value is the report's own text, or null when the report lacks it.

const REPORT_HEADINGS = [
  'Academic Assessment',
  'Student',
  'Current Program',
  'Requested Program',
  'CGPA Assessment',
  'Credit Hour Assessment',
  'Applicable Courses',
  'Issues / Conflicts',
  'Overall Assessment',
  'Recommendation',
] as const

type ReportHeading = (typeof REPORT_HEADINGS)[number]

/** Markdown emphasis, heading marks and list bullets around a line. */
const plain = (line: string) =>
  line
    .replace(/\*\*|__/g, '')
    .replace(/^\s*#+\s*/, '')
    .replace(/^\s*[-•*]\s+/, '')
    .trim()

function splitReport(report: string): Map<ReportHeading, string> {
  const sections = new Map<ReportHeading, string[]>()
  let currentHeading: ReportHeading | null = null
  for (const raw of report.split(/\r?\n/)) {
    const line = plain(raw)
    const lower = line.toLowerCase()
    const heading = REPORT_HEADINGS.find((name) => {
      const key = name.toLowerCase()
      return lower === key || lower.startsWith(`${key}:`)
    })
    if (heading) {
      currentHeading = heading
      const rest = line.slice(heading.length).replace(/^:\s*/, '')
      sections.set(heading, rest ? [rest] : [])
      continue
    }
    if (currentHeading && line) sections.get(currentHeading)?.push(line)
  }
  return new Map([...sections].map(([name, lines]) => [name, lines.join('\n').trim()]))
}

export interface ReportView {
  /** "Overall Assessment" text. */
  summary: string | null
  /** "Issues / Conflicts" text; null when missing or "None". */
  issues: string | null
  /** The report said exactly "None" for Issues / Conflicts. */
  noIssues: boolean
}

export function readReport(report: string | null | undefined): ReportView {
  const sections = splitReport(report ?? '')
  const issues = sections.has('Issues / Conflicts') ? (sections.get('Issues / Conflicts') ?? '') : null
  const noIssues = issues !== null && /^none\.?$/i.test(issues.trim())
  return {
    summary: text(sections.get('Overall Assessment')),
    issues: noIssues ? null : text(issues),
    noIssues,
  }
}

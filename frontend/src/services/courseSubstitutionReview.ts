import { ApiError, callBackend } from './backendApi'
import { supabase } from './supabase'
import {
  courseSubstitutionEvaluationPath,
  courseSubstitutionEvaluationsPath,
  evaluationRequestBody,
  type CourseSubstitutionEvaluationState,
  type CourseSubstitutionRunResponse,
} from '../utils/courseSubstitutionEvaluation'
import {
  CONNECTION_DECISION_MESSAGE,
  COURSE_SUBSTITUTION_DECISION_TYPES,
  courseSubstitutionDecisionErrorCode,
  courseSubstitutionDecisionErrorMessage,
  type DecisionChoice,
} from '../utils/courseSubstitutionDecision'
import {
  COURSE_SUBSTITUTION,
  buildCourseSubstitutionRecord,
  type CourseSubstitutionRecordResult,
} from '../utils/courseSubstitutionRecord'

// Staff review of one Course Substitution request, from independent sources
// (as for Incomplete Exam):
// - the request, its Course_Substitution row, both courses, the student, the
//   decision and the history are read from Supabase with the staff member's
//   own session (database policies decide what staff may read);
// - the AI evaluation comes from the backend's staff-only endpoints
//   (/api/staff/course-substitution/...), authorized by callBackend with that
//   session's token, which is never handled here;
// - the final decision is recorded only through decide_course_substitution_request.

export { ApiError }
export type { CourseSubstitutionEvaluationState, CourseSubstitutionRunResponse }

// ---------------------------------------------------------------------------
// AI evaluation (backend)

const EVALUATION_MESSAGES = {
  service: 'Course Substitution evaluation service',
  byStatus: {
    404: 'The evaluation service could not find this Course Substitution request.',
    // A check is already running, the request is no longer In Progress, or
    // its details are missing; the state reloaded afterwards shows which.
    409: 'The evaluation could not be started now: a check is already running, the request is no longer In Progress, or its details are missing.',
  },
}

/** The saved evaluation state of one request. Never runs the agent. */
export async function fetchCourseSubstitutionEvaluation(requestId: string): Promise<CourseSubstitutionEvaluationState> {
  const body = await callBackend<{ evaluation: CourseSubstitutionEvaluationState }>(
    courseSubstitutionEvaluationPath(requestId),
    { method: 'GET' },
    EVALUATION_MESSAGES,
  )
  return body.evaluation
}

/** Starts an evaluation, only on an explicit staff action: rerun=false for
 *  the first one (the backend runs it only when never evaluated, In Progress
 *  and with details), rerun=true to evaluate again. */
export async function requestCourseSubstitutionEvaluation(requestId: string, rerun: boolean): Promise<CourseSubstitutionRunResponse> {
  const body = await callBackend<{ evaluation: CourseSubstitutionRunResponse }>(
    courseSubstitutionEvaluationsPath(requestId),
    { method: 'POST', body: evaluationRequestBody(rerun) },
    EVALUATION_MESSAGES,
  )
  return body.evaluation
}

// ---------------------------------------------------------------------------
// Request record (Supabase, staff session)

async function fetchCourse(courseId: string | null) {
  if (!courseId) return null
  const result = await supabase.from('Course').select('Course_Name, Credit_Hours').eq('Course_ID', courseId).maybeSingle()
  if (result.error) throw result.error
  return result.data
}

export async function fetchCourseSubstitutionReviewRecord(requestId: string): Promise<CourseSubstitutionRecordResult> {
  const { data: request, error } = await supabase
    .from('Request')
    .select('Request_ID, Request_Type, Request_Date, Submission_Time, Current_Status, Description, Student_ID')
    .eq('Request_ID', requestId)
    .maybeSingle()
  if (error) throw error
  if (!request) return { kind: 'not-found' }
  if (request.Request_Type !== COURSE_SUBSTITUTION) return { kind: 'other-type', type: request.Request_Type }

  const [details, student, decision, history] = await Promise.all([
    supabase
      .from('Course_Substitution')
      .select('Original_Course_ID, Proposed_Course_ID, Reason')
      .eq('Request_ID', requestId)
      .maybeSingle(),
    supabase
      .from('Student')
      .select('Student_ID, Student_Name, Student_Email, CGPA, Completed_Hours, Program_ID, Program_Name, Program(College_Name)')
      .eq('Student_ID', String(request.Student_ID))
      .maybeSingle(),
    supabase
      .from('Decision')
      .select('Decision_ID, Decision_Type, Decision_Comment, Decision_Date, Staff_ID, Authorized_Staff(Staff_Name)')
      .eq('Request_ID', requestId)
      .in('Decision_Type', Object.values(COURSE_SUBSTITUTION_DECISION_TYPES))
      .order('Decision_Date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('Request_History').select('Final_Status, Completion_Date, Staff_ID').eq('Request_ID', requestId).maybeSingle(),
  ])
  if (details.error) throw details.error
  if (student.error) throw student.error
  if (decision.error) throw decision.error
  if (history.error) throw history.error

  const id = (value: unknown) => (value == null ? null : String(value))
  const [originalCourse, proposedCourse] = await Promise.all([
    fetchCourse(id(details.data?.Original_Course_ID)),
    fetchCourse(id(details.data?.Proposed_Course_ID)),
  ])

  return {
    kind: 'found',
    record: buildCourseSubstitutionRecord({
      request,
      details: details.data,
      originalCourse,
      proposedCourse,
      student: student.data as never,
      decision: decision.data as never,
      history: history.data,
    }),
  }
}

// ---------------------------------------------------------------------------
// Administrator final decision (database function, signed-in staff session).
// The staff member is identified by the database from the session; nothing
// here sends a staff ID. The AI result is advisory and is not sent.

export class CourseSubstitutionDecisionError extends Error {
  /** The database's refusal code (e.g. already_decided), or 'unknown'. */
  readonly reason: string

  constructor(reason: string, message: string) {
    super(message)
    this.name = 'CourseSubstitutionDecisionError'
    this.reason = reason
  }
}

export interface CourseSubstitutionDecisionResult {
  status: string
  decisionId: number | null
}

export async function decideCourseSubstitutionRequest(
  requestId: string,
  choice: DecisionChoice,
  explanation: string,
): Promise<CourseSubstitutionDecisionResult> {
  let result
  try {
    result = await supabase.rpc('decide_course_substitution_request', {
      p_request_id: requestId,
      p_decision: choice,
      p_explanation: explanation.trim(),
    })
  } catch {
    throw new CourseSubstitutionDecisionError('unknown', CONNECTION_DECISION_MESSAGE)
  }
  const { data, error } = result
  if (error) {
    const reason = courseSubstitutionDecisionErrorCode(error)
    throw new CourseSubstitutionDecisionError(reason, courseSubstitutionDecisionErrorMessage(reason))
  }
  const body = (data ?? {}) as { status?: string; decision_id?: number | null }
  return { status: String(body.status ?? ''), decisionId: body.decision_id ?? null }
}

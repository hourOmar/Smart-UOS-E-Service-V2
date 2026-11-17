import { API_BASE_URL } from '../config/api'
import { ApiError, callBackend } from './backendApi'
import { supabase } from './supabase'
import {
  courseEquivalencyEvaluationPath,
  courseEquivalencyEvaluationsPath,
  evaluationRequestBody,
  type CourseEquivalencyEvaluationState,
  type CourseEquivalencyRunResponse,
  type SyllabusSide,
} from '../utils/courseEquivalencyEvaluation'
import {
  SYLLABUS_BUCKET,
  downloadContentMatches,
  downloadName,
  pathBelongsTo,
  syllabiPath,
  syllabusUploadPath,
  uploadErrorCode,
  uploadErrorMessage,
  type SyllabiState,
  type SyllabusRow,
  type SyllabusUploadResult,
} from '../utils/courseEquivalencySyllabi'
import { COURSE_EQUIVALENCY, buildCourseEquivalencyRecord, type CourseEquivalencyRecordResult } from '../utils/courseEquivalencyRecord'
import {
  CONNECTION_DECISION_MESSAGE,
  COURSE_EQUIVALENCY_DECISION_TYPES,
  courseEquivalencyDecisionErrorCode,
  courseEquivalencyDecisionErrorMessage,
  type DecisionChoice,
} from '../utils/courseEquivalencyDecision'

// Staff review of one Course Equivalency request, from independent sources:
// - the request, its Course_Equivalency row, the courses, the student, the linked Program
//   Change and the history are read from Supabase with the staff member's own session
//   (database policies allow staff to read them);
// - the syllabi list, uploads and the AI evaluation come from the backend's staff-only
//   endpoints (/api/staff/course-equivalency/...), authorized with that session's token,
//   which is never stored or shown;
// - a syllabus is downloaded from the private Storage bucket with the same session (staff
//   read policy), never through a public or signed link, and only when its content matches
//   its registered type.
// The evaluation is advisory. The final decision is recorded only through the database
// function decide_course_equivalency_request (decideCourseEquivalencyRequest below), with the
// staff session; it records the decision only and never changes the transcript.

export { ApiError }

// ---------------------------------------------------------------------------
// AI evaluation (backend)

const EVALUATION_MESSAGES = {
  service: 'Course Equivalency evaluation service',
  byStatus: {
    404: 'The evaluation service could not find this Course Equivalency request.',
    // Already running, no longer In Progress, details or a syllabus missing; the state
    // reloaded afterwards shows which.
    409: 'The evaluation could not be started now: a check is already running, the request is no longer In Progress, or its details or a syllabus are missing.',
  },
}

/** The saved evaluation state of one request. Never runs the agents. */
export async function fetchCourseEquivalencyEvaluation(requestId: string): Promise<CourseEquivalencyEvaluationState> {
  const body = await callBackend<{ evaluation: CourseEquivalencyEvaluationState }>(
    courseEquivalencyEvaluationPath(requestId),
    { method: 'GET' },
    EVALUATION_MESSAGES,
  )
  return body.evaluation
}

/** Starts an evaluation: rerun=false for the first one (the backend runs it only when
 *  eligible), rerun=true to evaluate again. */
export async function requestCourseEquivalencyEvaluation(requestId: string, rerun: boolean): Promise<CourseEquivalencyRunResponse> {
  const body = await callBackend<{ evaluation: CourseEquivalencyRunResponse }>(
    courseEquivalencyEvaluationsPath(requestId),
    { method: 'POST', body: evaluationRequestBody(rerun) },
    EVALUATION_MESSAGES,
  )
  return body.evaluation
}

// ---------------------------------------------------------------------------
// Syllabi (backend list and upload; Storage download with the staff session)

const SYLLABI_MESSAGES = {
  service: 'syllabus service',
  byStatus: { 404: 'This Course Equivalency request was not found.' },
}

export async function fetchSyllabi(requestId: string): Promise<SyllabiState> {
  return callBackend<SyllabiState>(syllabiPath(requestId), { method: 'GET' }, SYLLABI_MESSAGES)
}

export class SyllabusUploadError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.name = 'SyllabusUploadError'
    this.status = status
    this.code = code
  }
}

/** Uploads one syllabus through the Phase 3B endpoint as multipart/form-data, with progress.
 *  `replaces`: the current version's ID, or 'none' when the side has no syllabus yet. */
export async function uploadSyllabus(
  requestId: string,
  side: SyllabusSide,
  file: File,
  replaces: string,
  onProgress: (fraction: number) => void,
): Promise<SyllabusUploadResult> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new SyllabusUploadError(401, null, uploadErrorMessage(401, null))

  const form = new FormData()
  form.append('file', file, file.name)
  form.append('replaces', replaces)

  return new Promise<SyllabusUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE_URL}${syllabusUploadPath(requestId, side)}`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.responseType = 'text'
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total)
    }
    xhr.onerror = () => reject(new SyllabusUploadError(0, null, uploadErrorMessage(0, null)))
    xhr.onload = () => {
      let body: unknown
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        body = null
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) {
        resolve(body as SyllabusUploadResult)
      } else {
        reject(new SyllabusUploadError(xhr.status, uploadErrorCode(body), uploadErrorMessage(xhr.status, body)))
      }
    }
    xhr.send(form)
  })
}

export const DOWNLOAD_MESSAGES = {
  invalid_path: 'This syllabus is not stored in this request’s folder, so it was not opened.',
  not_found: 'The syllabus file was not found in Storage (or is not visible to staff).',
  content_mismatch: 'The downloaded file does not match its registered type, so it was not opened.',
  unavailable: 'The syllabus could not be downloaded. Check your connection and try again.',
}

export class SyllabusDownloadError extends Error {
  readonly reason: keyof typeof DOWNLOAD_MESSAGES

  constructor(reason: keyof typeof DOWNLOAD_MESSAGES) {
    super(DOWNLOAD_MESSAGES[reason])
    this.name = 'SyllabusDownloadError'
    this.reason = reason
  }
}

/** Downloads one registered syllabus with the staff session and saves it in the browser. No
 *  public or signed link is created and the bucket stays private. The bytes are re-wrapped with
 *  the checked type, so a stored file can never be opened as HTML or script. */
export async function downloadSyllabus(requestId: string, row: SyllabusRow): Promise<void> {
  if (!pathBelongsTo(requestId, row.storage_path)) throw new SyllabusDownloadError('invalid_path')
  let result
  try {
    result = await supabase.storage.from(SYLLABUS_BUCKET).download(row.storage_path)
  } catch {
    throw new SyllabusDownloadError('unavailable')
  }
  const { data, error } = result
  if (error || !data) {
    const status = Number(
      (error as { statusCode?: string | number; status?: number } | null)?.statusCode ??
        (error as { status?: number } | null)?.status,
    )
    throw new SyllabusDownloadError(status === 400 || status === 404 ? 'not_found' : 'unavailable')
  }
  const head = new Uint8Array(await data.slice(0, 8).arrayBuffer())
  if (!downloadContentMatches(row.mime_type, head)) throw new SyllabusDownloadError('content_mismatch')
  const url = URL.createObjectURL(new Blob([data], { type: row.mime_type }))
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = downloadName(row)
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}

// ---------------------------------------------------------------------------
// Request record (Supabase, staff session)

export async function fetchCourseEquivalencyReviewRecord(requestId: string): Promise<CourseEquivalencyRecordResult> {
  const { data: request, error } = await supabase
    .from('Request')
    .select('Request_ID, Request_Type, Request_Date, Submission_Time, Current_Status, Description, Student_ID')
    .eq('Request_ID', requestId)
    .maybeSingle()
  if (error) throw error
  if (!request) return { kind: 'not-found' }
  if (request.Request_Type !== COURSE_EQUIVALENCY) return { kind: 'other-type', type: request.Request_Type }

  const [details, student, history, decision] = await Promise.all([
    supabase
      .from('Course_Equivalency')
      .select(
        'Old_Course_ID, New_Course_ID, Reason, Program_Change_Request_ID, Old_Program_ID, Old_Program_Name, New_Program_ID, New_Program_Name, Plan_Version, Old_Course_Grade, Old_Course_Term',
      )
      .eq('Request_ID', requestId)
      .maybeSingle(),
    supabase
      .from('Student')
      .select('Student_ID, Student_Name, Student_Email, CGPA, Completed_Hours, Program_ID, Program_Name, Program(College_Name)')
      .eq('Student_ID', String(request.Student_ID))
      .maybeSingle(),
    supabase.from('Request_History').select('Final_Status, Completion_Date, Staff_ID').eq('Request_ID', requestId).maybeSingle(),
    supabase
      .from('Decision')
      .select('Decision_ID, Decision_Type, Decision_Comment, Decision_Date, Staff_ID, Authorized_Staff(Staff_Name)')
      .eq('Request_ID', requestId)
      .in('Decision_Type', Object.values(COURSE_EQUIVALENCY_DECISION_TYPES))
      .order('Decision_Date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (details.error) throw details.error
  if (student.error) throw student.error
  if (history.error) throw history.error
  if (decision.error) throw decision.error

  const d = details.data as Record<string, unknown> | null
  const courseIds = d ? [String(d.Old_Course_ID), String(d.New_Course_ID)] : []
  let courses: Record<string, unknown>[] = []
  if (courseIds.length) {
    const result = await supabase.from('Course').select('Course_ID, Course_Name, Credit_Hours').in('Course_ID', courseIds)
    if (result.error) throw result.error
    courses = (result.data ?? []) as Record<string, unknown>[]
  }

  let programChange: Record<string, unknown> | null = null
  let programChangeRequest: Record<string, unknown> | null = null
  const pcId = d?.Program_Change_Request_ID ? String(d.Program_Change_Request_ID) : null
  if (pcId) {
    const [pc, pcRequest] = await Promise.all([
      supabase.from('Program_Change').select('Current_Program_Name, New_Program_Name').eq('Request_ID', pcId).maybeSingle(),
      supabase.from('Request').select('Current_Status, Request_Date').eq('Request_ID', pcId).maybeSingle(),
    ])
    // The linked Program Change is context only: the page still works when it cannot be read.
    programChange = pc.error ? null : (pc.data as Record<string, unknown> | null)
    programChangeRequest = pcRequest.error ? null : (pcRequest.data as Record<string, unknown> | null)
  }

  return {
    kind: 'found',
    record: buildCourseEquivalencyRecord({
      request: request as Record<string, unknown>,
      details: d,
      courses,
      student: student.data as Record<string, unknown> | null,
      programChange,
      programChangeRequest,
      history: history.data as Record<string, unknown> | null,
      decision: decision.data as Record<string, unknown> | null,
    }),
  }
}

// ---------------------------------------------------------------------------
// Administrator final decision (database function, signed-in staff session). The staff
// member is identified by the database from the session; nothing here sends a staff ID.
// The evaluation id is the result the administrator saw (the database refuses a decision on
// anything but the newest completed, current evaluation); confirmOverride is sent only after
// the administrator explicitly confirmed deciding against the agent's recommendation.
// DECISION ONLY: no transcript entry, credit, CGPA, completed-hours or program change.

export class CourseEquivalencyDecisionError extends Error {
  /** The database's refusal code (e.g. already_decided), or 'unknown'. */
  readonly reason: string

  constructor(reason: string, message: string) {
    super(message)
    this.name = 'CourseEquivalencyDecisionError'
    this.reason = reason
  }
}

export interface CourseEquivalencyDecisionResult {
  status: string
  decisionId: number | null
  override: boolean
}

export async function decideCourseEquivalencyRequest(
  requestId: string,
  choice: DecisionChoice,
  explanation: string,
  evaluationId: number,
  confirmOverride: boolean,
): Promise<CourseEquivalencyDecisionResult> {
  let result
  try {
    result = await supabase.rpc('decide_course_equivalency_request', {
      p_request_id: requestId,
      p_decision: choice,
      p_explanation: explanation.trim(),
      p_evaluation_id: evaluationId,
      p_confirm_override: confirmOverride,
    })
  } catch {
    throw new CourseEquivalencyDecisionError('unknown', CONNECTION_DECISION_MESSAGE)
  }
  const { data, error } = result
  if (error) {
    const reason = courseEquivalencyDecisionErrorCode(error)
    throw new CourseEquivalencyDecisionError(reason, courseEquivalencyDecisionErrorMessage(reason))
  }
  const body = (data ?? {}) as { status?: string; decision_id?: number | null; override?: boolean }
  return { status: String(body.status ?? ''), decisionId: body.decision_id ?? null, override: body.override === true }
}

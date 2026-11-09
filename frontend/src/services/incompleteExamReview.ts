import { ApiError, callBackend } from './backendApi'
import { supabase } from './supabase'
import {
  evaluationRequestBody,
  incompleteExamEvaluationPath,
  incompleteExamEvaluationsPath,
  type IncompleteExamEvaluationState,
  type IncompleteExamRunResponse,
} from '../utils/incompleteExamEvaluation'
import {
  CONNECTION_DECISION_MESSAGE,
  INCOMPLETE_EXAM_DECISION_TYPES,
  incompleteExamDecisionErrorCode,
  incompleteExamDecisionErrorMessage,
  type DecisionChoice,
} from '../utils/incompleteExamDecision'
import {
  INCOMPLETE_EXAM,
  PROOF_BUCKET,
  PROOF_ERROR_MESSAGES,
  buildIncompleteExamRecord,
  proofContentMatches,
  proofFileName,
  proofMimeType,
  type IncompleteExamRecordResult,
} from '../utils/incompleteExamRecord'

// Staff review of one Incomplete Exam request, from independent sources (as
// for Program Change):
// - the request, its Incomplete_Exam row, the course, the student, the
//   decision and the history are read from Supabase with the staff member's
//   own session (database policies allow staff to read them);
// - the AI evaluation comes from the backend's staff-only endpoints
//   (/api/staff/incomplete-exam/...), authorized by callBackend with that
//   session's token, which is never handled here;
// - proof documents are downloaded from the private Storage bucket with the
//   same session (staff read policy), never through a public or signed link;
// - the final decision is recorded only through decide_incomplete_exam_request.

export { ApiError }
export type { IncompleteExamEvaluationState, IncompleteExamRunResponse }

// ---------------------------------------------------------------------------
// AI evaluation (backend)

const EVALUATION_MESSAGES = {
  service: 'Incomplete Exam evaluation service',
  byStatus: {
    404: 'The evaluation service could not find this Incomplete Exam request.',
    // A check is already running, the request is no longer In Progress, or
    // its details are missing; the state reloaded afterwards shows which.
    409: 'The evaluation could not be started now: a check is already running, the request is no longer In Progress, or its details are missing.',
  },
}

/** The saved evaluation state of one request. Never runs the agents. */
export async function fetchIncompleteExamEvaluation(requestId: string): Promise<IncompleteExamEvaluationState> {
  const body = await callBackend<{ evaluation: IncompleteExamEvaluationState }>(
    incompleteExamEvaluationPath(requestId),
    { method: 'GET' },
    EVALUATION_MESSAGES,
  )
  return body.evaluation
}

/** Starts an evaluation, only on an explicit staff action: rerun=false for
 *  the first one (the backend runs it only when never evaluated, In Progress
 *  and with details), rerun=true to evaluate again. */
export async function requestIncompleteExamEvaluation(requestId: string, rerun: boolean): Promise<IncompleteExamRunResponse> {
  const body = await callBackend<{ evaluation: IncompleteExamRunResponse }>(
    incompleteExamEvaluationsPath(requestId),
    { method: 'POST', body: evaluationRequestBody(rerun) },
    EVALUATION_MESSAGES,
  )
  return body.evaluation
}

// ---------------------------------------------------------------------------
// Request record (Supabase, staff session)

export async function fetchIncompleteExamReviewRecord(requestId: string): Promise<IncompleteExamRecordResult> {
  const { data: request, error } = await supabase
    .from('Request')
    .select('Request_ID, Request_Type, Request_Date, Submission_Time, Current_Status, Description, Student_ID')
    .eq('Request_ID', requestId)
    .maybeSingle()
  if (error) throw error
  if (!request) return { kind: 'not-found' }
  if (request.Request_Type !== INCOMPLETE_EXAM) return { kind: 'other-type', type: request.Request_Type }

  const [details, student, decision, history] = await Promise.all([
    supabase
      .from('Incomplete_Exam')
      .select('Course_ID, Section_ID, Term, Exam_Type, Missed_Exam_Date, Missed_Exam_Time, Proof, Reason, Proof_Files')
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
      .in('Decision_Type', Object.values(INCOMPLETE_EXAM_DECISION_TYPES))
      .order('Decision_Date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('Request_History').select('Final_Status, Completion_Date, Staff_ID').eq('Request_ID', requestId).maybeSingle(),
  ])
  if (details.error) throw details.error
  if (student.error) throw student.error
  if (decision.error) throw decision.error
  if (history.error) throw history.error

  const courseId = details.data?.Course_ID == null ? null : String(details.data.Course_ID)
  let course: Record<string, unknown> | null = null
  if (courseId) {
    const result = await supabase.from('Course').select('Course_Name, Credit_Hours').eq('Course_ID', courseId).maybeSingle()
    if (result.error) throw result.error
    course = result.data
  }

  return {
    kind: 'found',
    record: buildIncompleteExamRecord({
      request,
      details: details.data,
      course,
      student: student.data as never,
      decision: decision.data as never,
      history: history.data,
    }),
  }
}

// ---------------------------------------------------------------------------
// Administrator final decision (database function, signed-in staff session).
// The staff member is identified by the database from the session; nothing
// here sends a staff ID. The AI recommendation is advisory and is not sent.

export class IncompleteExamDecisionError extends Error {
  /** The database's refusal code (e.g. already_decided), or 'unknown'. */
  readonly reason: string

  constructor(reason: string, message: string) {
    super(message)
    this.name = 'IncompleteExamDecisionError'
    this.reason = reason
  }
}

export interface IncompleteExamDecisionResult {
  status: string
  decisionId: number | null
}

export async function decideIncompleteExamRequest(
  requestId: string,
  choice: DecisionChoice,
  explanation: string,
): Promise<IncompleteExamDecisionResult> {
  let result
  try {
    result = await supabase.rpc('decide_incomplete_exam_request', {
      p_request_id: requestId,
      p_decision: choice,
      p_explanation: explanation.trim(),
    })
  } catch {
    throw new IncompleteExamDecisionError('unknown', CONNECTION_DECISION_MESSAGE)
  }
  const { data, error } = result
  if (error) {
    const reason = incompleteExamDecisionErrorCode(error)
    throw new IncompleteExamDecisionError(reason, incompleteExamDecisionErrorMessage(reason))
  }
  const body = (data ?? {}) as { status?: string; decision_id?: number | null }
  return { status: String(body.status ?? ''), decisionId: body.decision_id ?? null }
}

// ---------------------------------------------------------------------------
// Proof documents (private bucket, signed-in staff session)

export class ProofDocumentError extends Error {
  readonly reason: string

  constructor(reason: keyof typeof PROOF_ERROR_MESSAGES) {
    super(PROOF_ERROR_MESSAGES[reason])
    this.name = 'ProofDocumentError'
    this.reason = reason
  }
}

export interface OpenableProofDocument {
  name: string
  mimeType: string
  /** A temporary local object URL (blob:), valid only in this browser tab. */
  url: string
  /** Releases the URL; call it when the document is no longer shown. */
  revoke: () => void
}

/** Downloads one proof document with the staff session and returns a
 *  temporary local URL for it. No public or signed link is created and the
 *  bucket stays private. Only PDFs and images whose content matches their
 *  type are returned; the bytes are re-wrapped with the checked type, so a
 *  stored file can never be opened as HTML or script. */
export async function openProofDocument(requestId: string, path: string): Promise<OpenableProofDocument> {
  const name = proofFileName(requestId, path)
  if (!name) throw new ProofDocumentError('invalid_path')
  const mimeType = proofMimeType(name)
  if (!mimeType) throw new ProofDocumentError('unsupported_type')

  let result
  try {
    result = await supabase.storage.from(PROOF_BUCKET).download(path)
  } catch {
    throw new ProofDocumentError('unavailable')
  }
  const { data, error } = result
  if (error || !data) {
    const status = Number((error as { statusCode?: string | number; status?: number } | null)?.statusCode ??
      (error as { status?: number } | null)?.status)
    throw new ProofDocumentError(status === 400 || status === 404 ? 'not_found' : 'unavailable')
  }
  const head = new Uint8Array(await data.slice(0, 16).arrayBuffer())
  if (!proofContentMatches(mimeType, head)) throw new ProofDocumentError('content_mismatch')

  const url = URL.createObjectURL(new Blob([data], { type: mimeType }))
  return { name, mimeType, url, revoke: () => URL.revokeObjectURL(url) }
}

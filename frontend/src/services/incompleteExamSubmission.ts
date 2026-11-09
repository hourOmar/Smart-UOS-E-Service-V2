import { supabase } from './supabase'
import { courseNames } from './raiseCapacityReview'
import { CURRENT_TERM } from '../config/academicTerm'
import { PROOF_BUCKET } from '../utils/incompleteExamRecord'
import {
  IncompleteExamSubmitError,
  ProofUploadError,
  buildIncompleteExamEnrollments,
  checkProofFile,
  proofPath,
  safeProofFileName,
  submitErrorCode,
  toUploadReservation,
  uploadErrorCode,
  type ExamSelection,
  type IncompleteExamEnrollment,
  type IncompleteExamForm,
  type OpenRequestDetails,
  type ProofFileProblem,
  type TakesRow,
  type UploadReservationResult,
} from '../utils/incompleteExamSubmission'
import {
  newProofEntry,
  runIncompleteExamSubmission,
  type ProofEntry,
  type SubmissionInput,
  type SubmissionOutcome,
  type UploadReservation,
} from '../utils/incompleteExamSubmissionFlow'

// The student's Incomplete Exam submission, with the signed-in student's own
// session only (the anon-key client; row-level security and the database
// functions decide everything; no other key is used):
//   - enrolments: the student's own Takes rows of CURRENT_TERM, with course
//     names and the exams already requested (In Progress);
//   - reserve_incomplete_exam_upload: only when PDFs are selected;
//   - Storage: standard uploads into <reserved ID>/<safe name>.pdf, never
//     overwriting (upsert: false);
//   - submit_incomplete_exam_request (10 arguments): creates Request and
//     Incomplete_Exam with the uploaded paths, in one transaction.
// The order (and "never submit while a file has failed or is still
// uploading") is in utils/incompleteExamSubmissionFlow.ts.

export type { IncompleteExamEnrollment, IncompleteExamForm, ProofEntry, SubmissionOutcome, UploadReservation }

/** The signed-in student's enrolments of the current term, or null when the
 *  account is not linked to a student record. */
export async function fetchMyIncompleteExamEnrollments(): Promise<IncompleteExamEnrollment[] | null> {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) return null

  const { data: student, error: studentError } = await supabase
    .from('Student')
    .select('Student_ID')
    .eq('Auth_User_ID', user.id)
    .maybeSingle()
  if (studentError) throw studentError
  if (!student) return null
  const studentId = String((student as { Student_ID: unknown }).Student_ID)

  const [takes, open] = await Promise.all([
    supabase
      .from('Takes')
      .select('Course_ID, Section_ID, Term')
      .eq('Student_ID', studentId)
      .eq('Term', CURRENT_TERM),
    supabase
      .from('Request')
      .select('Request_ID, Incomplete_Exam(Course_ID, Section_ID, Term, Exam_Type)')
      .eq('Student_ID', studentId)
      .eq('Request_Type', 'Incomplete Exam')
      .eq('Current_Status', 'In Progress'),
  ])
  if (takes.error) throw takes.error
  if (open.error) throw open.error

  const takesRows = (takes.data ?? []) as TakesRow[]
  const openRows = ((open.data ?? []) as { Incomplete_Exam: OpenRequestDetails | OpenRequestDetails[] | null }[])
    .flatMap((r) => (Array.isArray(r.Incomplete_Exam) ? r.Incomplete_Exam : r.Incomplete_Exam ? [r.Incomplete_Exam] : []))
  const names = await courseNames(takesRows.map((r) => String(r.Course_ID ?? '')))
  return buildIncompleteExamEnrollments(takesRows, openRows, names, CURRENT_TERM)
}

// ---------------------------------------------------------------------------
// Files

/** The first bytes of a file (enough for the %PDF- signature). */
async function fileHead(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, 8).arrayBuffer())
}

/** Checks one selected file before it is accepted (name, MIME type, size, signature). */
export async function checkSelectedProof(file: File): Promise<ProofFileProblem | null> {
  try {
    return checkProofFile(file, await fileHead(file))
  } catch {
    return 'not_pdf_content'
  }
}

function randomHex(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** A list entry for a selected (already checked) file, with its safe storage name. */
export function proofEntryFor(file: File): ProofEntry<File> {
  return newProofEntry(crypto.randomUUID(), file, safeProofFileName(file.name, randomHex()))
}

// ---------------------------------------------------------------------------
// The three calls

async function reserveUpload(exam: ExamSelection): Promise<UploadReservationResult> {
  let result
  try {
    result = await supabase.rpc('reserve_incomplete_exam_upload', {
      p_course_id: exam.courseId,
      p_section_id: exam.sectionId,
      p_term: Number(exam.term),
      p_exam_type: exam.examType,
    })
  } catch {
    throw new IncompleteExamSubmitError('unknown')
  }
  if (result.error) throw new IncompleteExamSubmitError(submitErrorCode(result.error))
  const reservation = toUploadReservation(result.data)
  if (!reservation) throw new IncompleteExamSubmitError('unknown')
  return reservation
}

async function uploadProof(uploadId: string, entry: ProofEntry<File>): Promise<string> {
  // Checked again right before sending (the file may have changed on disk).
  if ((await checkSelectedProof(entry.file)) !== null) throw new ProofUploadError('invalid_file')
  const path = proofPath(uploadId, entry.fileName)
  let result
  try {
    result = await supabase.storage.from(PROOF_BUCKET).upload(path, entry.file, {
      upsert: false,
      contentType: 'application/pdf',
      cacheControl: '3600',
    })
  } catch (error) {
    throw new ProofUploadError(uploadErrorCode(error as { message?: string }))
  }
  if (result.error) throw new ProofUploadError(uploadErrorCode(result.error as { message?: string }))
  return path
}

async function submitRequest(form: IncompleteExamForm, uploadId: string | null, paths: string[]): Promise<string> {
  let result
  try {
    result = await supabase.rpc('submit_incomplete_exam_request', {
      p_course_id: form.courseId,
      p_section_id: form.sectionId,
      p_term: Number(form.term),
      p_exam_type: form.examType,
      p_missed_exam_date: form.missedExamDate,
      p_missed_exam_time: form.missedExamTime,
      p_reason: form.reason,
      p_proof: form.proofNote,
      p_upload_id: uploadId,
      p_proof_paths: paths,
    })
  } catch {
    throw new IncompleteExamSubmitError('unknown')
  }
  if (result.error) throw new IncompleteExamSubmitError(submitErrorCode(result.error))
  if (typeof result.data !== 'string' || result.data === '') throw new IncompleteExamSubmitError('unknown')
  return result.data
}

/** One submission attempt: reserve (only with PDFs) -> upload what is missing
 *  -> submit only when every file is uploaded. Safe to call again with the
 *  returned entries and reservation after a failure. */
export function submitIncompleteExam(input: SubmissionInput<File>): Promise<SubmissionOutcome<File>> {
  return runIncompleteExamSubmission<File>(
    { reserve: reserveUpload, upload: uploadProof, submit: submitRequest, now: () => Date.now() },
    input,
  )
}

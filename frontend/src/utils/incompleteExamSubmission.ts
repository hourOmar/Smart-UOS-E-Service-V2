// Rules for the student's Incomplete Exam submission form, kept free of
// React and Supabase so they can be tested with `npm test`.
//
// They mirror the database (submit_incomplete_exam_request and
// reserve_incomplete_exam_upload, which always check again) so the student
// sees a problem before anything is sent:
//   - FINAL exams only (midterm exams have a separate request service);
//     an enrolled course section of the term;
//   - missed exam date required, not after today in the UAE; a time;
//   - reason 20-1000 characters (trimmed); optional proof note <= 500;
//   - 0-5 optional PDFs, 10 MB each, 18 MB together, named
//     <8 hex>-<safe name>.pdf inside the reserved folder.
// A late request (over 4 working days, Friday/Saturday excluded, as the
// agent counts them) is allowed: the form only warns.

import { proofContentMatches, proofFileName } from './incompleteExamRecord.ts'

/** Incomplete Exam requests cover final exams only; midterm exams have a
 *  separate request service. Older Midterm records are shown as stored. */
export const EXAM_TYPES = ['Final'] as const
export type ExamType = (typeof EXAM_TYPES)[number]
export const INCOMPLETE_EXAM_TYPE: ExamType = 'Final'

export const FINAL_ONLY_MESSAGE =
  'Incomplete Exam requests are for final exams only. Midterm exams have a separate request service.'

export const REASON_MIN_LENGTH = 20
export const REASON_MAX_LENGTH = 1000
export const PROOF_NOTE_MAX_LENGTH = 500

export const MAX_PROOF_FILES = 5
export const MAX_PROOF_FILE_BYTES = 10 * 1024 * 1024   // 10485760, as the bucket and database
export const MAX_PROOF_TOTAL_BYTES = 18 * 1024 * 1024  // 18874368, as the database and agent

export const UAE_TIME_ZONE = 'Asia/Dubai'
export const SUBMISSION_WINDOW_WORKING_DAYS = 4

/** The database's rule for a proof file name inside the reserved folder. */
export const SAFE_PROOF_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.pdf$/i

// ---------------------------------------------------------------------------
// Dates (UAE)

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function isoParts(value: string): [number, number, number] | null {
  const match = ISO_DATE.exec(value)
  if (!match) return null
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return [y, m, d]
}

/** Today's date in the UAE as YYYY-MM-DD (the database uses the same day). */
export function uaeToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: UAE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Working days after `start` up to and including `end`, Friday and Saturday
 *  excluded (the agent's count; public holidays are not known). Null for an
 *  invalid date; 0 when `end` is not after `start`. */
export function workingDaysBetween(start: string, end: string): number | null {
  const a = isoParts(start)
  const b = isoParts(end)
  if (!a || !b) return null
  let current = Date.UTC(a[0], a[1] - 1, a[2])
  const last = Date.UTC(b[0], b[1] - 1, b[2])
  let days = 0
  while (current < last) {
    current += 86_400_000
    const weekday = new Date(current).getUTCDay()   // 5 = Friday, 6 = Saturday
    if (weekday !== 5 && weekday !== 6) days += 1
  }
  return days
}

/** True when the request would be outside the 4-working-day window. The
 *  form only warns; staff and the agent weigh it. */
export function isLateSubmission(missedExamDate: string, today: string): boolean {
  const days = workingDaysBetween(missedExamDate, today)
  return days !== null && days > SUBMISSION_WINDOW_WORKING_DAYS
}

// ---------------------------------------------------------------------------
// Form fields

export interface ExamSelection {
  courseId: string
  sectionId: string
  /** The term as stored, e.g. '202601'. */
  term: string
  examType: ExamType
}

export interface IncompleteExamForm extends ExamSelection {
  /** YYYY-MM-DD */
  missedExamDate: string
  /** HH:MM or HH:MM:SS (an <input type="time"> value) */
  missedExamTime: string
  reason: string
  /** Optional description of any supporting evidence. */
  proofNote: string
}

export type FormField = 'section' | 'examType' | 'missedExamDate' | 'missedExamTime' | 'reason' | 'proofNote'
export type FormErrors = Partial<Record<FormField, string>>

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

export function isExamType(value: unknown): value is ExamType {
  return value === 'Final'
}

export function examKey(exam: ExamSelection): string {
  return JSON.stringify([exam.courseId, exam.sectionId, exam.term, exam.examType])
}

export function reasonError(reason: string): string | null {
  const length = reason.trim().length
  if (length === 0) return 'Explain why you missed the exam.'
  if (length < REASON_MIN_LENGTH) return `Add a little more detail (at least ${REASON_MIN_LENGTH} characters).`
  if (length > REASON_MAX_LENGTH) return `The explanation can be at most ${REASON_MAX_LENGTH} characters.`
  return null
}

export function proofNoteError(note: string): string | null {
  return note.trim().length > PROOF_NOTE_MAX_LENGTH
    ? `The description of your evidence can be at most ${PROOF_NOTE_MAX_LENGTH} characters.`
    : null
}

export function missedExamDateError(date: string, today: string): string | null {
  if (!date) return 'Enter the date of the missed exam.'
  if (!isoParts(date)) return 'Enter a valid date.'
  if (date > today) return 'The missed exam date cannot be in the future.'
  return null
}

export function missedExamTimeError(time: string): string | null {
  if (!time) return 'Enter the time of the missed exam.'
  return TIME.test(time) ? null : 'Enter a valid time.'
}

/** Every field problem, keyed by field (empty object = valid). */
export function validateIncompleteExamForm(form: Partial<IncompleteExamForm>, today: string): FormErrors {
  const errors: FormErrors = {}
  if (!form.courseId?.trim() || !form.sectionId?.trim() || !form.term?.trim()) {
    errors.section = 'Select the course section of the missed exam.'
  }
  if (!isExamType(form.examType)) errors.examType = FINAL_ONLY_MESSAGE
  const date = missedExamDateError(form.missedExamDate ?? '', today)
  if (date) errors.missedExamDate = date
  const time = missedExamTimeError(form.missedExamTime ?? '')
  if (time) errors.missedExamTime = time
  const reason = reasonError(form.reason ?? '')
  if (reason) errors.reason = reason
  const proof = proofNoteError(form.proofNote ?? '')
  if (proof) errors.proofNote = proof
  return errors
}

// ---------------------------------------------------------------------------
// PDF checks (before anything is uploaded)

export type ProofFileProblem = 'not_pdf_name' | 'not_pdf_type' | 'empty_file' | 'file_too_large' | 'not_pdf_content'
export type ProofSelectionProblem = 'too_many_files' | 'total_too_large' | 'duplicate_file'

export const PROOF_FILE_PROBLEM_MESSAGES: Record<ProofFileProblem, string> = {
  not_pdf_name: 'Only PDF files (.pdf) can be attached.',
  not_pdf_type: 'This file is not a PDF document.',
  empty_file: 'This file is empty.',
  file_too_large: 'This PDF is larger than 10 MB.',
  not_pdf_content: 'This file does not contain a valid PDF document.',
}

export const PROOF_SELECTION_PROBLEM_MESSAGES: Record<ProofSelectionProblem, string> = {
  too_many_files: `You can attach at most ${MAX_PROOF_FILES} PDF files.`,
  total_too_large: 'The PDF files together are larger than 18 MB.',
  duplicate_file: 'This file is already attached.',
}

export interface ProofFileInfo {
  name: string
  /** The browser's MIME type. */
  type: string
  size: number
}

/** One file: name, MIME type, size and the first bytes (%PDF-). */
export function checkProofFile(file: ProofFileInfo, head: Uint8Array): ProofFileProblem | null {
  if (!/\.pdf$/i.test(file.name)) return 'not_pdf_name'
  if (file.type !== 'application/pdf') return 'not_pdf_type'
  if (file.size <= 0) return 'empty_file'
  if (file.size > MAX_PROOF_FILE_BYTES) return 'file_too_large'
  if (head.length < 5 || !proofContentMatches('application/pdf', head)) return 'not_pdf_content'
  return null
}

/** A stable key for spotting the same file selected twice. */
export function proofFileKey(file: ProofFileInfo & { lastModified?: number }): string {
  return JSON.stringify([file.name, file.size, file.lastModified ?? null])
}

/** The whole selection: count, the same file twice, and total size. */
export function checkProofSelection(
  files: readonly (ProofFileInfo & { lastModified?: number })[],
): ProofSelectionProblem | null {
  if (files.length > MAX_PROOF_FILES) return 'too_many_files'
  if (new Set(files.map(proofFileKey)).size !== files.length) return 'duplicate_file'
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_PROOF_TOTAL_BYTES) return 'total_too_large'
  return null
}

/** "340 KB", "1.2 MB" (1 MB = 1024 × 1024 bytes, as the limits). */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Per-file upload status, as shown to the student. */
export const PROOF_STATUS_LABELS: Record<'pending' | 'uploading' | 'uploaded' | 'failed', string> = {
  pending: 'Ready to upload',
  uploading: 'Uploading…',
  uploaded: 'Uploaded',
  failed: 'Not uploaded',
}

// ---------------------------------------------------------------------------
// Safe storage names

/** <8 hex>-<sanitised original name>.pdf, always matching SAFE_PROOF_NAME.
 *  `randomHex` must be 8 lowercase hex characters (from crypto). */
export function safeProofFileName(originalName: string, randomHex: string): string {
  if (!/^[0-9a-f]{8}$/.test(randomHex)) throw new Error('randomHex must be 8 lowercase hex characters.')
  const base = originalName
    .replace(/\.pdf$/i, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 100)
    .replace(/[-._]+$/g, '')
  const name = `${randomHex}-${base || 'document'}.pdf`
  if (!SAFE_PROOF_NAME.test(name)) throw new Error('Could not build a safe file name.')
  return name
}

export function proofPath(uploadId: string, fileName: string): string {
  return `${uploadId}/${fileName}`
}

/** The name a student sees for a stored document: the file name without the
 *  random prefix this form adds ("a1b2c3d4-Medical-Report.pdf" ->
 *  "Medical-Report.pdf"); older names are shown as stored. Null when the
 *  path is not a plain file inside the request's own folder. */
export function displayProofName(requestId: string, path: string): string | null {
  const name = proofFileName(requestId, path)
  if (!name) return null
  const match = /^[0-9a-f]{8}-(.+)$/.exec(name)
  return match ? match[1] : name
}

/** Why a submitted document could not be opened, in the student's words. */
export const STUDENT_DOCUMENT_ERROR_MESSAGES: Record<string, string> = {
  invalid_path: 'This document cannot be opened here.',
  unsupported_type: 'This document cannot be opened here.',
  content_mismatch: 'This document cannot be opened because its contents do not match its type.',
  not_found: 'This document could not be found.',
  unavailable: 'This document could not be downloaded. Check your connection and try again.',
  blocked_tab: 'Your browser blocked the new tab. Use Download instead.',
}

// ---------------------------------------------------------------------------
// Errors from the database (submit / reserve) and from Storage (upload)

export type SubmitErrorCode =
  | 'not_registered_student'
  | 'invalid_exam_type'
  | 'section_required'
  | 'invalid_term'
  | 'section_not_found'
  | 'not_enrolled'
  | 'missed_exam_date_required'
  | 'missed_exam_date_in_future'
  | 'missed_exam_time_required'
  | 'reason_required'
  | 'reason_too_short'
  | 'reason_too_long'
  | 'proof_too_long'
  | 'duplicate_request'
  | 'too_many_upload_sessions'
  | 'upload_session_required'
  | 'upload_session_not_found'
  | 'upload_session_used'
  | 'upload_session_expired'
  | 'upload_session_mismatch'
  | 'too_many_proof_files'
  | 'duplicate_proof_file'
  | 'invalid_proof_path'
  | 'proof_file_not_found'
  | 'invalid_proof_file_type'
  | 'proof_file_too_large'
  | 'proof_files_too_large'
  | 'reserved_id_in_use'
  | 'reserved_id_not_applied'
  | 'ambiguous_upload_session'
  | 'signed_out'
  | 'unknown'

const TRY_AGAIN = 'Please submit again.'

export const SUBMIT_ERROR_MESSAGES: Record<SubmitErrorCode, string> = {
  not_registered_student: 'This account is not registered as a student, so the request cannot be submitted.',
  invalid_exam_type: FINAL_ONLY_MESSAGE,
  section_required: 'Select the course section of the missed exam.',
  invalid_term: 'This term is not valid for an Incomplete Exam request.',
  section_not_found: 'This course section no longer exists. Select another one.',
  not_enrolled: 'You are not registered in this course section.',
  missed_exam_date_required: 'Enter the date of the missed exam.',
  missed_exam_date_in_future: 'The missed exam date cannot be in the future.',
  missed_exam_time_required: 'Enter the time of the missed exam.',
  reason_required: 'Explain why you missed the exam.',
  reason_too_short: `Add a little more detail (at least ${REASON_MIN_LENGTH} characters).`,
  reason_too_long: `The explanation can be at most ${REASON_MAX_LENGTH} characters.`,
  proof_too_long: `The description of your evidence can be at most ${PROOF_NOTE_MAX_LENGTH} characters.`,
  duplicate_request:
    'You already have an Incomplete Exam request in progress for this exam. You can find it in My Requests.',
  too_many_upload_sessions:
    'You have started too many submissions with documents today. Please try again tomorrow or contact the Registrar’s Office.',
  upload_session_required: `Your documents could not be linked to the request. ${TRY_AGAIN}`,
  upload_session_not_found: `Your document upload session could not be found. ${TRY_AGAIN}`,
  upload_session_used: 'These documents were already submitted with another request.',
  upload_session_expired: `Your document upload session expired. ${TRY_AGAIN}`,
  upload_session_mismatch: `The selected exam changed after your documents were prepared. ${TRY_AGAIN}`,
  too_many_proof_files: `You can attach at most ${MAX_PROOF_FILES} PDF files.`,
  duplicate_proof_file: 'The same PDF file is attached twice. Remove one of them.',
  invalid_proof_path: `A document could not be linked to the request. ${TRY_AGAIN}`,
  proof_file_not_found: `A document was not found after uploading. ${TRY_AGAIN}`,
  invalid_proof_file_type: 'One of the files is not a PDF document. Remove it and select a PDF.',
  proof_file_too_large: 'One of the PDF files is larger than 10 MB.',
  proof_files_too_large: 'The PDF files together are larger than 18 MB.',
  reserved_id_in_use: `Your request could not be prepared. ${TRY_AGAIN}`,
  reserved_id_not_applied: `Your request could not be saved. ${TRY_AGAIN}`,
  ambiguous_upload_session: `Your request could not be saved. ${TRY_AGAIN}`,
  signed_out: 'Your session has ended. Sign in again, then submit your request.',
  unknown: 'We couldn’t submit your request. Check your connection and try again.',
}

const SERVER_SUBMIT_CODES: ReadonlySet<string> = new Set(
  (Object.keys(SUBMIT_ERROR_MESSAGES) as SubmitErrorCode[]).filter((c) => c !== 'signed_out' && c !== 'unknown'),
)

/** After these, the reservation (and every upload into it) is discarded, so
 *  the next attempt reserves again and uploads the files again. */
export const RESERVATION_RESET_CODES: ReadonlySet<SubmitErrorCode> = new Set<SubmitErrorCode>([
  'upload_session_not_found', 'upload_session_used', 'upload_session_expired', 'upload_session_mismatch',
  'proof_file_not_found', 'invalid_proof_path', 'reserved_id_in_use', 'reserved_id_not_applied',
  'ambiguous_upload_session',
])

export class IncompleteExamSubmitError extends Error {
  readonly code: SubmitErrorCode

  constructor(code: SubmitErrorCode) {
    super(SUBMIT_ERROR_MESSAGES[code])
    this.name = 'IncompleteExamSubmitError'
    this.code = code
  }
}

/** The refusal code of a PostgREST / RPC error. */
export function submitErrorCode(error: { message?: string; code?: string } | null | undefined): SubmitErrorCode {
  const message = error?.message ?? ''
  if (SERVER_SUBMIT_CODES.has(message)) return message as SubmitErrorCode
  // Expired / missing session: PostgREST rejects the token, or the call
  // arrives as anon, which may not execute the functions.
  if (error?.code === 'PGRST301' || /jwt/i.test(message) || message.startsWith('permission denied')) {
    return 'signed_out'
  }
  return 'unknown'
}

export type ProofUploadErrorCode =
  | 'invalid_file'       // failed the checks again just before upload
  | 'file_too_large'     // Storage: over the bucket limit (413)
  | 'file_type_refused'  // Storage: not an allowed MIME type (415)
  | 'upload_refused'     // Storage policy / session refused it (401/403)
  | 'already_exists'     // the path exists (409): never accepted as this file
  | 'upload_failed'      // network or anything else

export const PROOF_UPLOAD_ERROR_MESSAGES: Record<ProofUploadErrorCode, string> = {
  invalid_file: 'This file is not a valid PDF of at most 10 MB. Remove it and select it again.',
  file_too_large: 'This PDF is larger than 10 MB. Remove it and select a smaller file.',
  file_type_refused: 'This file was refused because it is not a PDF. Remove it and select a PDF.',
  upload_refused: 'This file could not be uploaded (your session may have ended). Remove it, select it again and submit.',
  already_exists: 'This file could not be uploaded because a file with the same name already exists. Remove it and select it again.',
  upload_failed: 'This file could not be uploaded. Check your connection, remove it, select it again and submit.',
}

export class ProofUploadError extends Error {
  readonly code: ProofUploadErrorCode

  constructor(code: ProofUploadErrorCode) {
    super(PROOF_UPLOAD_ERROR_MESSAGES[code])
    this.name = 'ProofUploadError'
    this.code = code
  }
}

/** The kind of a Storage upload error (StorageApiError: status / statusCode / message). */
export function uploadErrorCode(
  error: { message?: string; status?: number | string; statusCode?: number | string } | null | undefined,
): ProofUploadErrorCode {
  const status = Number(error?.statusCode ?? error?.status)
  const message = (error?.message ?? '').toLowerCase()
  if (status === 409 || message.includes('already exists') || message.includes('duplicate')) return 'already_exists'
  if (status === 413 || message.includes('maximum allowed size') || message.includes('too large')) return 'file_too_large'
  if (status === 415 || message.includes('mime type')) return 'file_type_refused'
  if (status === 401 || status === 403 || message.includes('row-level security') || message.includes('unauthorized')) {
    return 'upload_refused'
  }
  return 'upload_failed'
}

// ---------------------------------------------------------------------------
// Enrolments the student can choose

export interface IncompleteExamEnrollment {
  key: string
  courseId: string
  courseName: string
  sectionId: string
  term: string
  /** Exam types that already have an In Progress request (duplicate_request otherwise). */
  openExamTypes: ExamType[]
}

export interface TakesRow {
  Course_ID: unknown
  Section_ID: unknown
  Term: unknown
}

export interface OpenRequestDetails {
  Course_ID: unknown
  Section_ID: unknown
  Term: unknown
  Exam_Type: unknown
}

const str = (value: unknown) => (value == null ? '' : String(value).trim())

/** The student's own enrolments of `term` (one per section, course order),
 *  each marked with the exam types already requested and In Progress. */
export function buildIncompleteExamEnrollments(
  takes: readonly TakesRow[],
  openRequests: readonly OpenRequestDetails[],
  names: ReadonlyMap<string, string>,
  term: string,
): IncompleteExamEnrollment[] {
  const open = new Map<string, Set<ExamType>>()
  for (const row of openRequests) {
    const examType = str(row.Exam_Type)
    if (!isExamType(examType)) continue
    const key = JSON.stringify([str(row.Course_ID), str(row.Section_ID), str(row.Term)])
    const types = open.get(key) ?? new Set<ExamType>()
    types.add(examType)
    open.set(key, types)
  }
  const seen = new Set<string>()
  const result: IncompleteExamEnrollment[] = []
  for (const row of takes) {
    const courseId = str(row.Course_ID)
    const sectionId = str(row.Section_ID)
    const rowTerm = str(row.Term)
    if (!courseId || !sectionId || rowTerm !== term) continue
    const key = JSON.stringify([courseId, sectionId, rowTerm])
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      key, courseId, courseName: names.get(courseId) ?? '', sectionId, term: rowTerm,
      openExamTypes: EXAM_TYPES.filter((t) => open.get(key)?.has(t)),
    })
  }
  return result.sort((a, b) => a.courseId.localeCompare(b.courseId) || a.sectionId.localeCompare(b.sectionId))
}

// ---------------------------------------------------------------------------
// The reservation answer

export interface UploadReservationResult {
  uploadId: string
  expiresAt: string
}

/** The reserve function's jsonb, checked; null when malformed. */
export function toUploadReservation(data: unknown): UploadReservationResult | null {
  const body = data as { upload_id?: unknown; expires_at?: unknown } | null
  if (!body || typeof body.upload_id !== 'string' || !/^STUD_INCRQ_INC2_[0-9]{6,}$/.test(body.upload_id)) return null
  if (typeof body.expires_at !== 'string' || Number.isNaN(Date.parse(body.expires_at))) return null
  return { uploadId: body.upload_id, expiresAt: body.expires_at }
}

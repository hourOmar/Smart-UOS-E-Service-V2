// The staff review record of one Incomplete Exam request, built from rows the
// staff session reads from Supabase, plus the proof-document helpers. Pure
// functions only (no network), so they can be tested with `npm test`.

import { INCOMPLETE_EXAM_DECISION_TYPES } from './incompleteExamDecision.ts'
import type { DecisionChoice } from './programChangeDecision.ts'

export const INCOMPLETE_EXAM = 'Incomplete Exam'

export interface IncompleteExamReviewStudent {
  id: string
  name: string | null
  email: string | null
  program: string | null
  college: string | null
  cgpa: number | null
  completedHours: number | null
}

export interface IncompleteExamDetails {
  courseId: string | null
  courseName: string | null
  creditHours: number | null
  sectionId: string | null
  term: number | null
  examType: string | null
  /** ISO date (YYYY-MM-DD). */
  missedExamDate: string | null
  /** HH:MM:SS. */
  missedExamTime: string | null
  /** The student's typed proof description (not a document). */
  proof: string | null
  reason: string | null
  /** Storage paths (<Request_ID>/<file>) of the uploaded proof documents. */
  proofFiles: string[]
}

export interface IncompleteExamDecisionRecord {
  id: number
  choice: DecisionChoice
  explanation: string
  staffId: number
  /** Only readable for the signed-in staff member's own decisions. */
  staffName: string | null
  /** ISO timestamp (UTC). */
  date: string | null
}

export interface IncompleteExamFinalRecord {
  status: string
  staffId: number | null
  date: string | null
}

export interface IncompleteExamReviewRecord {
  request: {
    id: string
    type: string
    status: string
    date: string | null
    time: string | null
    /** The student's description of what happened. */
    summary: string | null
    studentId: string
    /** Null when the request has no Incomplete_Exam row (it cannot be evaluated or decided). */
    details: IncompleteExamDetails | null
  }
  /** Null when the student's record cannot be found. */
  student: IncompleteExamReviewStudent | null
  decision: IncompleteExamDecisionRecord | null
  /** Request_History row, for a request finalized without a decision record. */
  history: IncompleteExamFinalRecord | null
}

export type IncompleteExamRecordResult =
  | { kind: 'found'; record: IncompleteExamReviewRecord }
  | { kind: 'not-found' }
  | { kind: 'other-type'; type: string }

type Row = Record<string, unknown>

export const text = (value: unknown): string | null => {
  const trimmed = value == null ? '' : String(value).trim()
  return trimmed === '' ? null : trimmed
}

const num = (value: unknown): number | null => {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Timestamps stored without a time zone are UTC (the database clock). */
export function utc(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`
}

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

export interface IncompleteExamRows {
  request: Row
  details: Row | null
  course: Row | null
  student: (Row & { Program?: Row | Row[] | null }) | null
  decision: (Row & { Authorized_Staff?: Row | Row[] | null }) | null
  history: Row | null
}

/** The review record from the rows read for one Incomplete Exam request. */
export function buildIncompleteExamRecord(rows: IncompleteExamRows): IncompleteExamReviewRecord {
  const { request, details, course, student, decision, history } = rows
  const program = first(student?.Program)
  const decider = first(decision?.Authorized_Staff)
  const files = Array.isArray(details?.Proof_Files) ? (details.Proof_Files as unknown[]) : []
  return {
    request: {
      id: String(request.Request_ID),
      type: String(request.Request_Type),
      status: String(request.Current_Status),
      date: text(request.Request_Date),
      time: text(request.Submission_Time),
      summary: text(request.Description),
      studentId: String(request.Student_ID),
      details: details
        ? {
            courseId: text(details.Course_ID),
            courseName: text(course?.Course_Name),
            creditHours: num(course?.Credit_Hours),
            sectionId: text(details.Section_ID),
            term: num(details.Term),
            examType: text(details.Exam_Type),
            missedExamDate: text(details.Missed_Exam_Date),
            missedExamTime: text(details.Missed_Exam_Time),
            proof: text(details.Proof),
            reason: text(details.Reason),
            proofFiles: files.map((f) => text(f)).filter((f): f is string => f !== null),
          }
        : null,
    },
    student: student
      ? {
          id: String(student.Student_ID),
          name: text(student.Student_Name),
          email: text(student.Student_Email),
          program: text(student.Program_Name) ?? text(student.Program_ID),
          college: text(program?.College_Name),
          cgpa: num(student.CGPA),
          completedHours: num(student.Completed_Hours),
        }
      : null,
    decision: decision
      ? {
          id: Number(decision.Decision_ID),
          choice: decision.Decision_Type === INCOMPLETE_EXAM_DECISION_TYPES.approve ? 'approve' : 'reject',
          explanation: String(decision.Decision_Comment ?? ''),
          staffId: Number(decision.Staff_ID),
          staffName: text(decider?.Staff_Name),
          date: utc(decision.Decision_Date),
        }
      : null,
    history: history
      ? { status: String(history.Final_Status), staffId: num(history.Staff_ID), date: utc(history.Completion_Date) }
      : null,
  }
}

/** The student's description, or null when it repeats the stated reason
 *  (same text, ignoring surrounding and repeated whitespace), so it is shown once. */
export function distinctDescription(reason: string | null | undefined, description: string | null | undefined): string | null {
  const normalize = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const shown = normalize(description)
  if (!shown) return null
  return shown === normalize(reason) ? null : (description ?? '').trim()
}

// ---------------------------------------------------------------------------
// Proof documents

export const PROOF_BUCKET = 'incomplete-exam-proofs'

/** Only these document types are ever opened; everything else is refused,
 *  because a local object URL runs with this application's origin (an HTML
 *  or SVG file must never be opened that way). */
export const PROOF_MIME_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

/** The file name of a stored proof path <requestId>/<file>, or null when the
 *  path is not a plain file inside this request's folder. */
export function proofFileName(requestId: string, path: string | null | undefined): string | null {
  const prefix = `${requestId}/`
  if (typeof path !== 'string' || !path.startsWith(prefix)) return null
  const name = path.slice(prefix.length)
  // eslint-disable-next-line no-control-regex
  if (!name || name === '.' || name === '..' || /[/\\]/.test(name) || /[\u0000-\u001f\u007f]/.test(name)) return null
  return name
}

/** The document type opened for a file name (by extension), or null. */
export function proofMimeType(name: string): string | null {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  return PROOF_MIME_TYPES[name.slice(dot + 1).toLowerCase()] ?? null
}

/** Checks a downloaded document's first bytes against its expected type. */
export function proofContentMatches(mimeType: string, head: Uint8Array): boolean {
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b)
  switch (mimeType) {
    case 'application/pdf':
      return starts(0x25, 0x50, 0x44, 0x46, 0x2d)                                   // %PDF-
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff)
    case 'image/webp':
      return starts(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
    default:
      return false
  }
}

export const PROOF_ERROR_MESSAGES: Record<string, string> = {
  invalid_path: 'This proof file is not stored in the request’s own folder, so it is not opened.',
  unsupported_type: 'This proof file is not a PDF or image, so it is not opened.',
  content_mismatch: 'This proof file’s contents do not match its type, so it is not opened.',
  not_found: 'The proof file could not be found, or your account may not open it.',
  unavailable: 'The proof file could not be downloaded. Check your connection and try again.',
}

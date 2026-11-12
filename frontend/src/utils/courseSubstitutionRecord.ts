// The staff review record of one Course Substitution request, built from rows
// the staff session reads from Supabase. Pure functions only (no network), so
// they can be tested with `npm test`. The small helpers (text, utc,
// distinctDescription) are copies of the Incomplete Exam ones, kept here so
// the two review pages stay independent.

import { COURSE_SUBSTITUTION_DECISION_TYPES } from './courseSubstitutionDecision.ts'
import type { DecisionChoice } from './programChangeDecision.ts'

export const COURSE_SUBSTITUTION = 'Course Substitution'

export interface CourseSubstitutionReviewStudent {
  id: string
  name: string | null
  email: string | null
  program: string | null
  college: string | null
  cgpa: number | null
  completedHours: number | null
}

export interface CourseRef {
  id: string | null
  name: string | null
  creditHours: number | null
}

export interface CourseSubstitutionDetails {
  original: CourseRef
  proposed: CourseRef
  reason: string | null
}

export interface CourseSubstitutionDecisionRecord {
  id: number
  choice: DecisionChoice
  explanation: string
  staffId: number
  /** Only readable for the signed-in staff member's own decisions. */
  staffName: string | null
  /** ISO timestamp (UTC). */
  date: string | null
}

export interface CourseSubstitutionFinalRecord {
  status: string
  staffId: number | null
  date: string | null
}

export interface CourseSubstitutionReviewRecord {
  request: {
    id: string
    type: string
    status: string
    date: string | null
    time: string | null
    /** The student's description of the request. */
    summary: string | null
    studentId: string
    /** Null when the request has no Course_Substitution row (it cannot be evaluated or decided). */
    details: CourseSubstitutionDetails | null
  }
  /** Null when the student's record cannot be found. */
  student: CourseSubstitutionReviewStudent | null
  decision: CourseSubstitutionDecisionRecord | null
  /** Request_History row, for a request finalized without a decision record. */
  history: CourseSubstitutionFinalRecord | null
}

export type CourseSubstitutionRecordResult =
  | { kind: 'found'; record: CourseSubstitutionReviewRecord }
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

export interface CourseSubstitutionRows {
  request: Row
  details: Row | null
  originalCourse: Row | null
  proposedCourse: Row | null
  student: (Row & { Program?: Row | Row[] | null }) | null
  decision: (Row & { Authorized_Staff?: Row | Row[] | null }) | null
  history: Row | null
}

function course(id: unknown, row: Row | null): CourseRef {
  return { id: text(id), name: text(row?.Course_Name), creditHours: num(row?.Credit_Hours) }
}

/** The review record from the rows read for one Course Substitution request. */
export function buildCourseSubstitutionRecord(rows: CourseSubstitutionRows): CourseSubstitutionReviewRecord {
  const { request, details, originalCourse, proposedCourse, student, decision, history } = rows
  const program = first(student?.Program)
  const decider = first(decision?.Authorized_Staff)
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
            original: course(details.Original_Course_ID, originalCourse),
            proposed: course(details.Proposed_Course_ID, proposedCourse),
            reason: text(details.Reason),
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
          choice: decision.Decision_Type === COURSE_SUBSTITUTION_DECISION_TYPES.approve ? 'approve' : 'reject',
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

/** "CS101 Programming I", or the ID alone when no name is known. */
export function courseTitle(ref: CourseRef | null | undefined): string | null {
  return [ref?.id, ref?.name].filter(Boolean).join(' ') || null
}

/** The student's description, or null when it repeats the stated reason
 *  (same text, ignoring surrounding and repeated whitespace), so it is shown once. */
export function distinctDescription(reason: string | null | undefined, description: string | null | undefined): string | null {
  const normalize = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const shown = normalize(description)
  if (!shown) return null
  return shown === normalize(reason) ? null : (description ?? '').trim()
}

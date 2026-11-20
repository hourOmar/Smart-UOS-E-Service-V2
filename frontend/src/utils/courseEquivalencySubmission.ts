// Rules and data contract of the student's Course Equivalency request, kept free
// of network imports so they can be tested on their own
// (tests/courseEquivalencySubmission.test.ts).
//
// The database is the authority (database/maintenance/course-equivalency-
// submission/01_install.sql):
//   public.get_my_course_equivalency_options() -> jsonb
//     { status, program, old_courses[], new_courses[] }
//   public.submit_course_equivalency_request(p_old_course_id, p_new_course_id,
//                                            p_reason) -> Request_ID
// Both identify the student from the session. These helpers only parse the
// reply defensively and give the student immediate feedback.

import type { CourseOption } from './courseSubstitutionSubmission'

export const REASON_MAX_LENGTH = 1000

// ---------------------------------------------------------------------------
// Options (get_my_course_equivalency_options)

/** Statuses the database returns, plus two client-side ones. */
export type OptionsStatus =
  | 'ok'
  | 'not_registered_student'
  | 'no_approved_program_change'
  | 'program_change_in_progress'
  | 'program_change_record_inconsistent'
  | 'study_plan_unavailable'
  | 'signed_out' // the session was rejected before the function ran
  | 'unexpected' // a reply this page does not understand

const SERVER_STATUSES: ReadonlySet<string> = new Set([
  'ok',
  'not_registered_student',
  'no_approved_program_change',
  'program_change_in_progress',
  'program_change_record_inconsistent',
  'study_plan_unavailable',
])

export interface ApplicableProgram {
  programId: string
  programName: string
  /** Only for status 'ok'. */
  planVersion: string | null
  programChangeRequestId: string | null
}

export interface CompletedCourse {
  id: string
  name: string | null
  creditHours: number | null
  /** The best graded attempt. */
  grade: string
  term: number | null
}

export interface PlanCourse {
  id: string
  name: string | null
  creditHours: number | null
  requirementType: string | null
}

export interface CourseEquivalencyOptions {
  status: OptionsStatus
  program: ApplicableProgram | null
  oldCourses: CompletedCourse[]
  newCourses: PlanCourse[]
}

const clean = (value: unknown): string | null => {
  const text = value == null ? '' : String(value).trim()
  return text === '' ? null : text
}

const number = (value: unknown): number | null => {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const byId = <T extends { id: string }>(items: T[]): T[] => {
  const seen = new Map<string, T>()
  for (const item of items) if (!seen.has(item.id)) seen.set(item.id, item)
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}

export const UNEXPECTED_OPTIONS: CourseEquivalencyOptions = {
  status: 'unexpected',
  program: null,
  oldCourses: [],
  newCourses: [],
}

/** The options reply, checked field by field. Anything malformed is 'unexpected'
 *  (never shown raw). Completed courses come with any recorded grade (A to F);
 *  a row without a grade is dropped, as the database never sends one. */
export function parseCourseEquivalencyOptions(data: unknown): CourseEquivalencyOptions {
  if (!isRecord(data) || typeof data.status !== 'string' || !SERVER_STATUSES.has(data.status)) return UNEXPECTED_OPTIONS
  const status = data.status as OptionsStatus

  let program: ApplicableProgram | null = null
  if (isRecord(data.program)) {
    const programId = clean(data.program.program_id)
    const programName = clean(data.program.program_name)
    if (programId && programName) {
      program = {
        programId,
        programName,
        planVersion: clean(data.program.plan_version),
        programChangeRequestId: clean(data.program.program_change_request_id),
      }
    }
  }

  if (status !== 'ok') return { status, program, oldCourses: [], newCourses: [] }
  if (!program || !program.planVersion || !Array.isArray(data.old_courses) || !Array.isArray(data.new_courses)) {
    return UNEXPECTED_OPTIONS
  }

  const oldCourses: CompletedCourse[] = []
  for (const row of data.old_courses) {
    if (!isRecord(row)) continue
    const id = clean(row.course_id)
    const grade = clean(row.grade)
    if (!id || !grade) continue
    oldCourses.push({ id, name: clean(row.course_name), creditHours: number(row.credit_hours), grade, term: number(row.term) })
  }
  const newCourses: PlanCourse[] = []
  for (const row of data.new_courses) {
    if (!isRecord(row)) continue
    const id = clean(row.course_id)
    if (!id) continue
    newCourses.push({
      id,
      name: clean(row.course_name),
      creditHours: number(row.credit_hours),
      requirementType: clean(row.requirement_type),
    })
  }
  return { status, program, oldCourses: byId(oldCourses), newCourses: byId(newCourses) }
}

/** Completed courses for the picker: the best grade (and term) as the detail line. */
export function completedCourseOptions(courses: readonly CompletedCourse[]): CourseOption[] {
  return courses.map((c) => ({
    id: c.id,
    name: c.name,
    creditHours: c.creditHours,
    detail: c.term != null ? `Best grade ${c.grade} · Term ${c.term}` : `Best grade ${c.grade}`,
  }))
}

/** Study-plan courses for the picker: the requirement type as the detail line. */
export function planCourseOptions(courses: readonly PlanCourse[]): CourseOption[] {
  return courses.map((c) => ({
    id: c.id,
    name: c.name,
    creditHours: c.creditHours,
    detail: c.requirementType ? `${c.requirementType} course` : null,
  }))
}

/** What the page says instead of the form, for every status except 'ok'. */
export const BLOCKED_MESSAGES: Record<Exclude<OptionsStatus, 'ok'>, { title: string; text: string }> = {
  not_registered_student: {
    title: 'No student record',
    text: 'This account is not linked to a student record, so a course equivalency cannot be requested.',
  },
  no_approved_program_change: {
    title: 'An approved program change is required',
    text: 'You can request a course equivalency only after a Program Change request has been approved. Pending or rejected requests do not qualify.',
  },
  program_change_in_progress: {
    title: 'A program change is in progress',
    text: 'You have a Program Change request in progress. You can request a course equivalency after it has been decided.',
  },
  program_change_record_inconsistent: {
    title: 'Your program change needs review',
    text: 'Your program change record could not be confirmed. Contact the Registrar’s Office before requesting a course equivalency.',
  },
  study_plan_unavailable: {
    title: 'Study plan not available yet',
    text: 'The study plan of your new program is not available in the system yet, so a course equivalency cannot be requested. Contact the Registrar’s Office.',
  },
  signed_out: {
    title: 'Your session has ended',
    text: 'Sign in again, then open this request form.',
  },
  unexpected: {
    title: 'The request form could not be prepared',
    text: 'Something unexpected happened while preparing the form. Try again later.',
  },
}

// ---------------------------------------------------------------------------
// Form validation (the database checks the same rules)

export interface CourseEquivalencyFormValues {
  oldCourseId: string | null
  newCourseId: string | null
  reason: string
}

export type FormField = 'oldCourse' | 'newCourse' | 'reason'
export type FormErrors = Partial<Record<FormField, string>>

/** Null when the reason is acceptable (counted after trimming). */
export function reasonError(reason: string): string | null {
  const length = reason.trim().length
  if (!length) return 'Explain why the completed course should count as the new course.'
  if (length > REASON_MAX_LENGTH) return `The reason can be at most ${REASON_MAX_LENGTH} characters.`
  return null
}

export function validateCourseEquivalencyForm(form: CourseEquivalencyFormValues): FormErrors {
  const errors: FormErrors = {}
  if (!form.oldCourseId) errors.oldCourse = 'Select the course you completed.'
  if (!form.newCourseId) errors.newCourse = 'Select the course in your new program’s study plan.'
  else if (form.oldCourseId && form.newCourseId === form.oldCourseId) {
    errors.newCourse = 'The requested course must be different from the completed course.'
  }
  const reason = reasonError(form.reason)
  if (reason) errors.reason = reason
  return errors
}

// ---------------------------------------------------------------------------
// Refusals of submit_course_equivalency_request

export type CourseEquivalencyErrorCode =
  | 'not_registered_student'
  | 'reason_required'
  | 'reason_too_short'
  | 'reason_too_long'
  | 'no_approved_program_change'
  | 'program_change_in_progress'
  | 'program_change_record_inconsistent'
  | 'study_plan_unavailable'
  | 'old_course_not_found'
  | 'new_course_not_found'
  | 'same_course'
  | 'old_course_not_completed'
  | 'old_course_grade_below_minimum'
  | 'new_course_not_in_study_plan'
  | 'new_course_already_passed'
  | 'duplicate_request'
  | 'signed_out'
  | 'unknown'

const SUBMIT_CODES: ReadonlySet<string> = new Set([
  'not_registered_student',
  'reason_required',
  'reason_too_short',
  'reason_too_long',
  'no_approved_program_change',
  'program_change_in_progress',
  'program_change_record_inconsistent',
  'study_plan_unavailable',
  'old_course_not_found',
  'new_course_not_found',
  'same_course',
  'old_course_not_completed',
  'old_course_grade_below_minimum',
  'new_course_not_in_study_plan',
  'new_course_already_passed',
  'duplicate_request',
])

/** Refusals that mean the page's options are out of date: reload them. */
export const RELOAD_OPTIONS_CODES: ReadonlySet<CourseEquivalencyErrorCode> = new Set<CourseEquivalencyErrorCode>([
  'no_approved_program_change',
  'program_change_in_progress',
  'program_change_record_inconsistent',
  'study_plan_unavailable',
  'old_course_not_completed',
  'old_course_grade_below_minimum',
  'new_course_not_in_study_plan',
  'new_course_already_passed',
])

export const SUBMIT_ERROR_MESSAGES: Record<CourseEquivalencyErrorCode, string> = {
  not_registered_student: 'This account is not registered as a student, so the request cannot be submitted.',
  reason_required: 'Explain why the completed course should count as the new course.',
  // Legacy code: the database no longer has a minimum length.
  reason_too_short: 'Your reason is too short. Add a little more detail, then submit again.',
  reason_too_long: `The reason can be at most ${REASON_MAX_LENGTH} characters.`,
  no_approved_program_change: 'You need an approved Program Change before requesting a course equivalency.',
  program_change_in_progress: 'You have a Program Change request in progress. Try again after it has been decided.',
  program_change_record_inconsistent:
    'Your program change record could not be confirmed. Contact the Registrar’s Office.',
  study_plan_unavailable: 'The study plan of your new program is not available yet.',
  old_course_not_found: 'The completed course is no longer available. Select another course.',
  new_course_not_found: 'The requested course is no longer available. Select another course.',
  same_course: 'The requested course must be different from the completed course.',
  old_course_not_completed: 'The completed course has no released grade. Select another course.',
  old_course_grade_below_minimum: 'The completed course needs a grade of C+ or higher. Select another course.',
  new_course_not_in_study_plan: 'The requested course is not in your new program’s current study plan.',
  new_course_already_passed: 'You have already passed the requested course. Select another course.',
  duplicate_request: 'You already have a Course Equivalency request in progress for these two courses.',
  signed_out: 'Your session has ended. Sign in again, then submit your request.',
  unknown: 'We couldn’t submit your request. Check your connection and try again.',
}

export class CourseEquivalencySubmitError extends Error {
  readonly code: CourseEquivalencyErrorCode

  constructor(code: CourseEquivalencyErrorCode) {
    super(SUBMIT_ERROR_MESSAGES[code])
    this.name = 'CourseEquivalencySubmitError'
    this.code = code
  }
}

/** True when the call failed because the session was rejected (expired token,
 *  or the request arrived as anon, which may not execute the function). */
export function isSignedOutError(error: { message?: string; code?: string } | null | undefined): boolean {
  const message = error?.message ?? ''
  return error?.code === 'PGRST301' || /jwt/i.test(message) || message.startsWith('permission denied')
}

/** The refusal code for an error returned by the database call. Raw database
 *  text is never shown: anything unrecognised is 'unknown'. */
export function submitErrorCode(error: { message?: string; code?: string } | null | undefined): CourseEquivalencyErrorCode {
  const message = error?.message ?? ''
  if (SUBMIT_CODES.has(message)) return message as CourseEquivalencyErrorCode
  if (isSignedOutError(error)) return 'signed_out'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Request details: the program context stored with a request (none on the
// three requests submitted before Phase 2A)

export interface DetailField {
  label: string
  value: string
}

const programText = (id: unknown, name: unknown) => [clean(id), clean(name)].filter(Boolean).join(' · ')

/** The stored program context as detail fields; an empty list when the request
 *  has none (legacy requests), so no empty or broken field is ever shown. */
export function courseEquivalencyContextFields(row: Record<string, unknown>): DetailField[] {
  if (!clean(row.Program_Change_Request_ID)) return []
  const fields: DetailField[] = [
    { label: 'Previous program', value: programText(row.Old_Program_ID, row.Old_Program_Name) },
    { label: 'New program', value: programText(row.New_Program_ID, row.New_Program_Name) },
    { label: 'Study plan version', value: clean(row.Plan_Version) ?? '' },
    {
      label: 'Grade in completed course',
      value: [clean(row.Old_Course_Grade), clean(row.Old_Course_Term) && `Term ${clean(row.Old_Course_Term)}`]
        .filter(Boolean)
        .join(' · '),
    },
    { label: 'Approved Program Change', value: clean(row.Program_Change_Request_ID) ?? '' },
  ]
  return fields.filter((field) => field.value !== '')
}

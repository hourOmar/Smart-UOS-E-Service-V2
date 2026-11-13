// Rules of the student's Course Substitution request, kept free of network
// imports so they can be tested on their own (tests/courseSubstitutionSubmission.test.ts).
// The database function submit_course_substitution_request enforces the same
// rules; these only give the student immediate feedback.

export const REASON_MIN_LENGTH = 20
export const REASON_MAX_LENGTH = 1000

/** One course of public."Course", as offered in the pickers. */
export interface CourseOption {
  id: string
  name: string | null
  creditHours: number | null
}

export interface CourseSubstitutionForm {
  originalCourseId: string | null
  proposedCourseId: string | null
  reason: string
}

export type FormField = 'originalCourse' | 'proposedCourse' | 'reason'
export type FormErrors = Partial<Record<FormField, string>>

/** Null when the reason is acceptable (counted after trimming). The maximum is
 *  also enforced by the field itself (maxLength). */
export function reasonError(reason: string): string | null {
  const length = reason.trim().length
  if (!length) return 'Explain why you need this substitution.'
  if (length < REASON_MIN_LENGTH) return `Add a little more detail (at least ${REASON_MIN_LENGTH} characters).`
  if (length > REASON_MAX_LENGTH) return `The reason can be at most ${REASON_MAX_LENGTH} characters.`
  return null
}

export function originalCourseError(originalId: string | null): string | null {
  return originalId ? null : 'Select the course in your plan that you want to replace.'
}

export function proposedCourseError(originalId: string | null, proposedId: string | null): string | null {
  if (!proposedId) return 'Select the course you want to take instead.'
  if (originalId && proposedId === originalId) return 'The proposed course must be different from the original course.'
  return null
}

/** Every problem with the form; empty when it can be submitted. */
export function validateCourseSubstitutionForm(form: CourseSubstitutionForm): FormErrors {
  const errors: FormErrors = {}
  const original = originalCourseError(form.originalCourseId)
  const proposed = proposedCourseError(form.originalCourseId, form.proposedCourseId)
  const reason = reasonError(form.reason)
  if (original) errors.originalCourse = original
  if (proposed) errors.proposedCourse = proposed
  if (reason) errors.reason = reason
  return errors
}

const clean = (value: unknown): string | null => {
  const text = value == null ? '' : String(value).trim()
  return text === '' ? null : text
}

/** The course list from public."Course" rows: rows without an ID are left out,
 *  each ID appears once, sorted by ID. */
export function buildCourseOptions(rows: readonly Record<string, unknown>[]): CourseOption[] {
  const byId = new Map<string, CourseOption>()
  for (const row of rows) {
    const id = clean(row.Course_ID)
    if (!id || byId.has(id)) continue
    const hours = row.Credit_Hours == null || row.Credit_Hours === '' ? null : Number(row.Credit_Hours)
    byId.set(id, { id, name: clean(row.Course_Name), creditHours: Number.isFinite(hours) ? hours : null })
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}

/** Courses whose ID or name contains the query (case-insensitive); all of them
 *  for an empty query. */
export function filterCourses(options: readonly CourseOption[], query: string): CourseOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...options]
  return options.filter((c) => c.id.toLowerCase().includes(q) || (c.name ?? '').toLowerCase().includes(q))
}

/** "CS401 Compilers", or the ID alone when no name is known. */
export function courseLabel(course: CourseOption | null | undefined): string {
  return course ? [course.id, course.name].filter(Boolean).join(' ') : ''
}

// ---------------------------------------------------------------------------
// Refusals of submit_course_substitution_request

export type CourseSubstitutionErrorCode =
  | 'not_registered_student'
  | 'reason_required'
  | 'reason_too_short'
  | 'reason_too_long'
  | 'original_course_not_found'
  | 'proposed_course_not_found'
  | 'same_course'
  | 'duplicate_request'
  | 'signed_out'
  | 'unknown'

const SERVER_CODES: ReadonlySet<string> = new Set([
  'not_registered_student',
  'reason_required',
  'reason_too_short',
  'reason_too_long',
  'original_course_not_found',
  'proposed_course_not_found',
  'same_course',
  'duplicate_request',
])

export const SUBMIT_ERROR_MESSAGES: Record<CourseSubstitutionErrorCode, string> = {
  not_registered_student: 'This account is not registered as a student, so the request cannot be submitted.',
  reason_required: 'Explain why you need this substitution.',
  reason_too_short: `Add a little more detail (at least ${REASON_MIN_LENGTH} characters).`,
  reason_too_long: `The reason can be at most ${REASON_MAX_LENGTH} characters.`,
  original_course_not_found: 'The original course is no longer available. Select another course.',
  proposed_course_not_found: 'The proposed course is no longer available. Select another course.',
  same_course: 'The proposed course must be different from the original course.',
  duplicate_request:
    'You already have a Course Substitution request in progress. You can submit a new one after it has been decided.',
  signed_out: 'Your session has ended. Sign in again, then submit your request.',
  unknown: 'We couldn’t submit your request. Check your connection and try again.',
}

export class CourseSubstitutionSubmitError extends Error {
  readonly code: CourseSubstitutionErrorCode

  constructor(code: CourseSubstitutionErrorCode) {
    super(SUBMIT_ERROR_MESSAGES[code])
    this.name = 'CourseSubstitutionSubmitError'
    this.code = code
  }
}

/** The refusal code for an error returned by the database call. Raw database
 *  text is never shown: anything unrecognised is 'unknown'. */
export function submitErrorCode(error: { message?: string; code?: string } | null | undefined): CourseSubstitutionErrorCode {
  const message = error?.message ?? ''
  if (SERVER_CODES.has(message)) return message as CourseSubstitutionErrorCode
  // Expired/missing session: PostgREST rejects the token, or the request
  // arrives as anon, which may not execute the function.
  if (error?.code === 'PGRST301' || /jwt/i.test(message) || message.startsWith('permission denied')) {
    return 'signed_out'
  }
  return 'unknown'
}

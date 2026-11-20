// Rules of the student's Course Substitution request, kept free of network
// imports so they can be tested on their own (tests/courseSubstitutionSubmission.test.ts).
// The database function submit_course_substitution_request enforces the same
// rules; these only give the student immediate feedback.

export const REASON_MAX_LENGTH = 1000

/** One course as offered in the pickers (from get_my_course_substitution_options;
 *  Course Equivalency builds the same shape from its own options). */
export interface CourseOption {
  id: string
  name: string | null
  creditHours: number | null
  /** Optional second line in the picker (e.g. a grade, or Required / Elective course). */
  detail?: string | null
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// ---------------------------------------------------------------------------
// Options (get_my_course_substitution_options)

/** Statuses the database returns, plus 'unexpected' for a reply this page
 *  does not understand. */
export type OptionsStatus = 'ok' | 'not_registered_student' | 'study_plan_unavailable' | 'unexpected'

const SERVER_STATUSES: ReadonlySet<string> = new Set(['ok', 'not_registered_student', 'study_plan_unavailable'])

export interface StudyPlanProgram {
  programId: string
  programName: string
  /** Only for status 'ok'. */
  planVersion: string | null
}

export interface CourseSubstitutionOptions {
  status: OptionsStatus
  program: StudyPlanProgram | null
  /** Required courses of the student's current study plan, not completed. */
  originalCourses: CourseOption[]
  /** Elective courses of the same plan, not completed. */
  proposedCourses: CourseOption[]
}

export const UNEXPECTED_OPTIONS: CourseSubstitutionOptions = {
  status: 'unexpected',
  program: null,
  originalCourses: [],
  proposedCourses: [],
}

/** One list of the reply: rows without an ID are left out, each ID appears
 *  once, sorted by ID; `detail` is the picker's second line. */
function courseList(rows: readonly unknown[], detail: string): CourseOption[] {
  const byId = new Map<string, CourseOption>()
  for (const row of rows) {
    if (!isRecord(row)) continue
    const id = clean(row.course_id)
    if (!id || byId.has(id)) continue
    const hours = row.credit_hours == null || row.credit_hours === '' ? null : Number(row.credit_hours)
    byId.set(id, { id, name: clean(row.course_name), creditHours: Number.isFinite(hours) ? hours : null, detail })
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}

/** The options reply, checked field by field. Anything malformed is
 *  'unexpected' (never shown raw). The database already filtered both lists
 *  (study plan, requirement type, completed and in-progress courses); this
 *  only reads them. */
export function parseCourseSubstitutionOptions(data: unknown): CourseSubstitutionOptions {
  if (!isRecord(data) || typeof data.status !== 'string' || !SERVER_STATUSES.has(data.status)) return UNEXPECTED_OPTIONS
  const status = data.status as OptionsStatus

  let program: StudyPlanProgram | null = null
  if (isRecord(data.program)) {
    const programId = clean(data.program.program_id)
    const programName = clean(data.program.program_name)
    if (programId && programName) program = { programId, programName, planVersion: clean(data.program.plan_version) }
  }

  if (status !== 'ok') return { status, program, originalCourses: [], proposedCourses: [] }
  if (!program || !program.planVersion || !Array.isArray(data.original_courses) || !Array.isArray(data.proposed_courses)) {
    return UNEXPECTED_OPTIONS
  }
  return {
    status,
    program,
    originalCourses: courseList(data.original_courses, 'Required course'),
    proposedCourses: courseList(data.proposed_courses, 'Elective course'),
  }
}

/** What the page shows instead of the form when the options say no. */
export const BLOCKED_MESSAGES: Record<Exclude<OptionsStatus, 'ok'>, { title: string; text: string }> = {
  not_registered_student: {
    title: 'No student record',
    text: 'This account is not linked to a student record, so a course substitution cannot be requested.',
  },
  study_plan_unavailable: {
    title: 'Course substitution is not available for your program yet',
    text:
      'The study plan of your program is not available in the system, so the courses you could substitute cannot be '
      + 'listed. Contact the Registrar’s Office for help.',
  },
  unexpected: {
    title: 'We couldn’t read your course options',
    text: 'Something went wrong while loading your study plan. Try again in a moment.',
  },
}

/** Shown instead of the form when a list is empty. */
export const NO_ORIGINAL_COURSES =
  'You have no Required course left to substitute: every Required course in your study plan is already passed or '
  + 'in progress.'
export const NO_PROPOSED_COURSES =
  'There is no Elective course you can take instead: every Elective course in your study plan is already passed or '
  + 'in progress.'

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
  // Study plan and transcript rules (course-substitution-options:v1)
  | 'study_plan_unavailable'
  | 'original_course_not_in_study_plan'
  | 'original_course_not_required'
  | 'original_course_already_completed'
  | 'original_course_in_progress'
  | 'proposed_course_not_in_study_plan'
  | 'proposed_course_not_elective'
  | 'proposed_course_already_completed'
  | 'proposed_course_in_progress'
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
  'study_plan_unavailable',
  'original_course_not_in_study_plan',
  'original_course_not_required',
  'original_course_already_completed',
  'original_course_in_progress',
  'proposed_course_not_in_study_plan',
  'proposed_course_not_elective',
  'proposed_course_already_completed',
  'proposed_course_in_progress',
])

/** Refusals meaning the student's study plan, transcript or the course list
 *  changed since the page loaded: the options are loaded again and both
 *  choices cleared. */
export const RELOAD_OPTIONS_CODES: ReadonlySet<CourseSubstitutionErrorCode> = new Set<CourseSubstitutionErrorCode>([
  'study_plan_unavailable',
  'original_course_not_found',
  'proposed_course_not_found',
  'original_course_not_in_study_plan',
  'original_course_not_required',
  'original_course_already_completed',
  'original_course_in_progress',
  'proposed_course_not_in_study_plan',
  'proposed_course_not_elective',
  'proposed_course_already_completed',
  'proposed_course_in_progress',
])

export const SUBMIT_ERROR_MESSAGES: Record<CourseSubstitutionErrorCode, string> = {
  not_registered_student: 'This account is not registered as a student, so the request cannot be submitted.',
  reason_required: 'Explain why you need this substitution.',
  // Legacy code: the database no longer has a minimum length.
  reason_too_short: 'Your reason is too short. Add a little more detail, then submit again.',
  reason_too_long: `The reason can be at most ${REASON_MAX_LENGTH} characters.`,
  original_course_not_found: 'The original course is no longer available. Select another course.',
  proposed_course_not_found: 'The proposed course is no longer available. Select another course.',
  same_course: 'The proposed course must be different from the original course.',
  duplicate_request:
    'You already have a Course Substitution request In Progress for this original course. You can request it again '
    + 'once that request has been decided; requests for other original courses can still be submitted.',
  study_plan_unavailable:
    'The study plan of your program is not available, so a course substitution cannot be requested. Contact the Registrar’s Office.',
  original_course_not_in_study_plan:
    'The original course is not in your current study plan. The course lists have been refreshed; select another course.',
  original_course_not_required:
    'The original course must be a Required course in your study plan. The course lists have been refreshed; select another course.',
  original_course_already_completed:
    'You have already passed the original course, so it cannot be substituted. The course lists have been refreshed.',
  original_course_in_progress:
    'You are taking the original course now (no grade recorded yet), so it cannot be substituted until the grade is recorded.',
  proposed_course_not_in_study_plan:
    'The proposed course is not in your current study plan. The course lists have been refreshed; select another course.',
  proposed_course_not_elective:
    'The proposed course must be an Elective course in your study plan. The course lists have been refreshed; select another course.',
  proposed_course_already_completed:
    'You have already passed the proposed course, so it cannot be used as a substitute. The course lists have been refreshed.',
  proposed_course_in_progress:
    'You are taking the proposed course now (no grade recorded yet), so it cannot be used as a substitute. Select another course.',
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

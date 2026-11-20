// Rules of the student's Course Substitution request (the database function
// enforces the same ones). Run: npm test (no browser or database).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  REASON_MAX_LENGTH,
  BLOCKED_MESSAGES,
  NO_ORIGINAL_COURSES,
  NO_PROPOSED_COURSES,
  RELOAD_OPTIONS_CODES,
  SUBMIT_ERROR_MESSAGES,
  UNEXPECTED_OPTIONS,
  courseLabel,
  filterCourses,
  originalCourseError,
  parseCourseSubstitutionOptions,
  proposedCourseError,
  reasonError,
  submitErrorCode,
  validateCourseSubstitutionForm,
} from '../src/utils/courseSubstitutionSubmission.ts'

// -- reason ------------------------------------------------------------------------

test('the reason is required and at most 1000 characters after trimming; no minimum', () => {
  assert.equal(REASON_MAX_LENGTH, 1000)
  assert.match(reasonError('') ?? '', /Explain why/)
  assert.match(reasonError('   \n ') ?? '', /Explain why/)
  assert.equal(reasonError('x'.repeat(19)), null)
  assert.equal(reasonError(`   ${'x'.repeat(19)}   `), null)
  assert.equal(reasonError('x'), null)
  assert.doesNotMatch(SUBMIT_ERROR_MESSAGES.reason_too_short, /\d/)   // legacy refusal names no length
  assert.equal(reasonError('x'.repeat(1000)), null)
  assert.equal(reasonError(`  ${'x'.repeat(1000)}  `), null)
  assert.match(reasonError('x'.repeat(1001)) ?? '', /at most 1000 characters/)
})

// -- courses -------------------------------------------------------------------------

test('both courses are required and must differ', () => {
  assert.match(originalCourseError(null) ?? '', /Select the course in your plan/)
  assert.equal(originalCourseError('CS401'), null)
  assert.match(proposedCourseError('CS401', null) ?? '', /Select the course you want to take/)
  assert.match(proposedCourseError('CS401', 'CS401') ?? '', /must be different/)
  assert.equal(proposedCourseError('CS401', 'CS455'), null)
  assert.equal(proposedCourseError(null, 'CS455'), null)
})

test('the whole form: valid, and each missing field reported', () => {
  const reason = 'I graduate this term and the course is not offered.'
  assert.deepEqual(validateCourseSubstitutionForm({ originalCourseId: 'CS401', proposedCourseId: 'CS455', reason }), {})
  const errors = validateCourseSubstitutionForm({ originalCourseId: null, proposedCourseId: null, reason: '' })
  assert.deepEqual(Object.keys(errors).sort(), ['originalCourse', 'proposedCourse', 'reason'])
  assert.deepEqual(
    Object.keys(validateCourseSubstitutionForm({ originalCourseId: 'CS401', proposedCourseId: 'CS401', reason })),
    ['proposedCourse'],
  )
})

// -- options (get_my_course_substitution_options) -------------------------------------

const OK_REPLY = {
  status: 'ok',
  program: { program_id: '1501', program_name: 'Bachelor of Science in Computer Science', plan_version: 'CS-WEB-2026-10-31' },
  original_courses: [
    { course_id: '1501211', course_name: 'Programming I', credit_hours: 3 },
    { course_id: '1501215', course_name: 'Data Structures', credit_hours: 3 },
  ],
  proposed_courses: [{ course_id: '1501441', course_name: 'Machine Learning', credit_hours: 3 }],
}

test('the options reply: Required courses become the original list, Elective courses the proposed list', () => {
  const options = parseCourseSubstitutionOptions(OK_REPLY)
  assert.equal(options.status, 'ok')
  assert.deepEqual(options.program, {
    programId: '1501', programName: 'Bachelor of Science in Computer Science', planVersion: 'CS-WEB-2026-10-31',
  })
  assert.deepEqual(options.originalCourses, [
    { id: '1501211', name: 'Programming I', creditHours: 3, detail: 'Required course' },
    { id: '1501215', name: 'Data Structures', creditHours: 3, detail: 'Required course' },
  ])
  assert.deepEqual(options.proposedCourses, [
    { id: '1501441', name: 'Machine Learning', creditHours: 3, detail: 'Elective course' },
  ])
})

test('the lists are taken exactly as the database filtered them: cleaned, one per ID, sorted, nothing added', () => {
  const options = parseCourseSubstitutionOptions({
    ...OK_REPLY,
    original_courses: [
      { course_id: ' 1501215 ', course_name: ' Data Structures ', credit_hours: '3' },
      { course_id: '0401100', course_name: '', credit_hours: null },
      { course_id: '1501215', course_name: 'Duplicate', credit_hours: 3 },
      { course_id: null, course_name: 'No ID' },
      { course_id: '', course_name: 'Empty ID' },
      'not a course',
    ],
  })
  assert.deepEqual(options.originalCourses, [
    { id: '0401100', name: null, creditHours: null, detail: 'Required course' },
    { id: '1501215', name: 'Data Structures', creditHours: 3, detail: 'Required course' },
  ])
  // The other list is untouched: the client never merges, re-filters or adds courses.
  assert.deepEqual(options.proposedCourses.map((c) => c.id), ['1501441'])
  assert.equal(courseLabel(options.originalCourses[1]), '1501215 Data Structures')
  assert.equal(courseLabel(options.originalCourses[0]), '0401100')
  assert.equal(courseLabel(null), '')
})

test('empty lists stay empty (the page shows a message instead of the form)', () => {
  const none = parseCourseSubstitutionOptions({ ...OK_REPLY, original_courses: [], proposed_courses: [] })
  assert.equal(none.status, 'ok')
  assert.deepEqual(none.originalCourses, [])
  assert.deepEqual(none.proposedCourses, [])
  assert.match(NO_ORIGINAL_COURSES, /no Required course left/)
  assert.match(NO_PROPOSED_COURSES, /no Elective course/)
})

test('a student without a study plan or without a student record is blocked, with no courses', () => {
  const noPlan = parseCourseSubstitutionOptions({
    status: 'study_plan_unavailable',
    program: { program_id: '0302', program_name: 'Bachelor of Science in Business Administration - Management' },
    original_courses: [{ course_id: 'X', course_name: 'ignored' }],
    proposed_courses: [],
  })
  assert.equal(noPlan.status, 'study_plan_unavailable')
  assert.equal(noPlan.program?.programName, 'Bachelor of Science in Business Administration - Management')
  assert.equal(noPlan.program?.planVersion, null)
  assert.deepEqual(noPlan.originalCourses, [])
  const noStudent = parseCourseSubstitutionOptions({ status: 'not_registered_student', program: null })
  assert.equal(noStudent.status, 'not_registered_student')
  assert.equal(noStudent.program, null)
  for (const status of ['not_registered_student', 'study_plan_unavailable', 'unexpected'] as const) {
    assert.ok(BLOCKED_MESSAGES[status].title.trim() && BLOCKED_MESSAGES[status].text.trim(), status)
    assert.doesNotMatch(BLOCKED_MESSAGES[status].text, /_/)
  }
  assert.match(BLOCKED_MESSAGES.study_plan_unavailable.title, /not available for your program/)
})

test('a malformed reply is unexpected, never shown raw', () => {
  for (const reply of [null, undefined, 'ok', [], {}, { status: 'granted' },
    { ...OK_REPLY, program: null },
    { ...OK_REPLY, program: { program_id: '1501', program_name: 'CS' } },        // no plan version
    { ...OK_REPLY, original_courses: 'all' },
    { ...OK_REPLY, proposed_courses: undefined }]) {
    assert.deepEqual(parseCourseSubstitutionOptions(reply), UNEXPECTED_OPTIONS, JSON.stringify(reply))
  }
})

test('the search matches the course ID or name, case-insensitively', () => {
  const options = parseCourseSubstitutionOptions({
    ...OK_REPLY,
    original_courses: [
      { course_id: '1501211', course_name: 'Programming I' },
      { course_id: '1501215', course_name: 'Data Structures' },
      { course_id: '0401100', course_name: 'Calculus I' },
    ],
  }).originalCourses
  assert.equal(filterCourses(options, '').length, 3)
  assert.equal(filterCourses(options, '   ').length, 3)
  assert.deepEqual(filterCourses(options, '15012').map((c) => c.id), ['1501211', '1501215'])
  assert.deepEqual(filterCourses(options, 'data').map((c) => c.id), ['1501215'])
  assert.deepEqual(filterCourses(options, 'CALCULUS').map((c) => c.id), ['0401100'])
  assert.deepEqual(filterCourses(options, 'zzz'), [])
})

// -- refusals --------------------------------------------------------------------------

test('every refusal of submit_course_substitution_request has a student-friendly message', () => {
  for (const code of ['not_registered_student', 'reason_required', 'reason_too_short', 'reason_too_long',
    'original_course_not_found', 'proposed_course_not_found', 'same_course', 'duplicate_request',
    // study plan and transcript rules
    'study_plan_unavailable',
    'original_course_not_in_study_plan', 'original_course_not_required',
    'original_course_already_completed', 'original_course_in_progress',
    'proposed_course_not_in_study_plan', 'proposed_course_not_elective',
    'proposed_course_already_completed', 'proposed_course_in_progress']) {
    assert.equal(submitErrorCode({ message: code }), code)
    assert.ok(SUBMIT_ERROR_MESSAGES[submitErrorCode({ message: code })].length > 0)
    assert.doesNotMatch(SUBMIT_ERROR_MESSAGES[submitErrorCode({ message: code })], /_/)
  }
})

test('the study-plan refusals say which course and why', () => {
  assert.match(SUBMIT_ERROR_MESSAGES.original_course_not_required, /original course must be a Required course/)
  assert.match(SUBMIT_ERROR_MESSAGES.proposed_course_not_elective, /proposed course must be an Elective course/)
  assert.match(SUBMIT_ERROR_MESSAGES.original_course_already_completed, /already passed the original course/)
  assert.match(SUBMIT_ERROR_MESSAGES.proposed_course_already_completed, /already passed the proposed course/)
  assert.match(SUBMIT_ERROR_MESSAGES.original_course_in_progress, /no grade recorded yet/)
  assert.match(SUBMIT_ERROR_MESSAGES.proposed_course_in_progress, /no grade recorded yet/)
  assert.match(SUBMIT_ERROR_MESSAGES.original_course_not_in_study_plan, /not in your current study plan/)
  assert.match(SUBMIT_ERROR_MESSAGES.study_plan_unavailable, /study plan of your program is not available/)
})

test('the duplicate refusal names the rule: one In Progress request per original course', () => {
  assert.match(SUBMIT_ERROR_MESSAGES.duplicate_request, /In Progress for this original course/)
  assert.match(SUBMIT_ERROR_MESSAGES.duplicate_request, /other original courses can still be submitted/)
})

test('refusals meaning the options changed reload them; input and duplicate refusals do not', () => {
  for (const code of ['study_plan_unavailable', 'original_course_not_found', 'proposed_course_not_found',
    'original_course_not_in_study_plan', 'original_course_not_required', 'original_course_already_completed',
    'original_course_in_progress', 'proposed_course_not_in_study_plan', 'proposed_course_not_elective',
    'proposed_course_already_completed', 'proposed_course_in_progress'] as const) {
    assert.ok(RELOAD_OPTIONS_CODES.has(code), code)
  }
  for (const code of ['not_registered_student', 'reason_required', 'reason_too_short', 'reason_too_long',
    'same_course', 'duplicate_request', 'signed_out', 'unknown'] as const) {
    assert.ok(!RELOAD_OPTIONS_CODES.has(code), code)
  }
})

test('session problems are signed_out', () => {
  assert.equal(submitErrorCode({ code: 'PGRST301', message: 'JWT expired' }), 'signed_out')
  assert.equal(submitErrorCode({ message: 'invalid JWT' }), 'signed_out')
  assert.equal(submitErrorCode({ message: 'permission denied for function submit_course_substitution_request' }), 'signed_out')
  assert.match(SUBMIT_ERROR_MESSAGES.signed_out, /Sign in again/)
})

test('anything else is the generic message, never raw database text', () => {
  for (const error of [{ message: 'duplicate key value violates unique constraint "Request_pkey"' },
    { message: 'null value in column "Student_ID"' }, { message: 'toString' }, {}, null, undefined]) {
    assert.equal(submitErrorCode(error), 'unknown')
  }
  assert.match(SUBMIT_ERROR_MESSAGES.unknown, /couldn’t submit your request/)
})

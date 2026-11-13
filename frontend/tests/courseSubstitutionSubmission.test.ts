// Rules of the student's Course Substitution request (the database function
// enforces the same ones). Run: npm test (no browser or database).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
  SUBMIT_ERROR_MESSAGES,
  buildCourseOptions,
  courseLabel,
  filterCourses,
  originalCourseError,
  proposedCourseError,
  reasonError,
  submitErrorCode,
  validateCourseSubstitutionForm,
} from '../src/utils/courseSubstitutionSubmission.ts'

// -- reason ------------------------------------------------------------------------

test('the reason is 20 to 1000 characters after trimming', () => {
  assert.equal(REASON_MIN_LENGTH, 20)
  assert.equal(REASON_MAX_LENGTH, 1000)
  assert.match(reasonError('') ?? '', /Explain why/)
  assert.match(reasonError('   \n ') ?? '', /Explain why/)
  assert.match(reasonError('x'.repeat(19)) ?? '', /at least 20 characters/)
  assert.match(reasonError(`   ${'x'.repeat(19)}   `) ?? '', /at least 20 characters/)   // spaces do not count
  assert.equal(reasonError('x'.repeat(20)), null)
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

test('the course list: cleaned, one per ID, sorted by ID', () => {
  const options = buildCourseOptions([
    { Course_ID: ' 1501211 ', Course_Name: ' Programming I ', Credit_Hours: 3 },
    { Course_ID: '0401100', Course_Name: 'Calculus', Credit_Hours: '4' },
    { Course_ID: '1501211', Course_Name: 'Duplicate', Credit_Hours: 3 },
    { Course_ID: null, Course_Name: 'No ID' },
    { Course_ID: '', Course_Name: 'Empty ID' },
    { Course_ID: '1501100', Course_Name: '', Credit_Hours: null },
  ])
  assert.deepEqual(options, [
    { id: '0401100', name: 'Calculus', creditHours: 4 },
    { id: '1501100', name: null, creditHours: null },
    { id: '1501211', name: 'Programming I', creditHours: 3 },
  ])
  assert.equal(courseLabel(options[2]), '1501211 Programming I')
  assert.equal(courseLabel(options[1]), '1501100')
  assert.equal(courseLabel(null), '')
})

test('the search matches the course ID or name, case-insensitively', () => {
  const options = buildCourseOptions([
    { Course_ID: '1501211', Course_Name: 'Programming I' },
    { Course_ID: '1501215', Course_Name: 'Data Structures' },
    { Course_ID: '0401100', Course_Name: 'Calculus I' },
  ])
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
    'original_course_not_found', 'proposed_course_not_found', 'same_course', 'duplicate_request']) {
    assert.equal(submitErrorCode({ message: code }), code)
    assert.ok(SUBMIT_ERROR_MESSAGES[submitErrorCode({ message: code })].length > 0)
    assert.doesNotMatch(SUBMIT_ERROR_MESSAGES[submitErrorCode({ message: code })], /_/)
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

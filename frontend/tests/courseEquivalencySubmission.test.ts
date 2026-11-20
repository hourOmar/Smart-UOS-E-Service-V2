// Data contract and rules of the student's Course Equivalency request (the
// database functions enforce the same rules). Run: npm test (no browser or
// database). The option payloads below follow get_my_course_equivalency_options
// in database/maintenance/course-equivalency-submission/01_install.sql.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BLOCKED_MESSAGES,
  REASON_MAX_LENGTH,
  RELOAD_OPTIONS_CODES,
  SUBMIT_ERROR_MESSAGES,
  completedCourseOptions,
  courseEquivalencyContextFields,
  parseCourseEquivalencyOptions,
  planCourseOptions,
  reasonError,
  submitErrorCode,
  validateCourseEquivalencyForm,
  type OptionsStatus,
} from '../src/utils/courseEquivalencySubmission.ts'

const OK_PAYLOAD = {
  status: 'ok',
  program: {
    program_id: '1502',
    program_name: 'Bachelor of Science in Computer Engineering',
    plan_version: 'CPE-WEB-2026-10-31',
    program_change_request_id: 'STUD_CPSR_CHP3_000123',
  },
  old_courses: [
    { course_id: '1501215', course_name: 'Data Structures', credit_hours: 3, grade: 'B+', term: 202410 },
    { course_id: '1440131', course_name: 'Calculus I', credit_hours: 3, grade: 'C+', term: 202310 },
  ],
  new_courses: [
    { course_id: '1502326', course_name: 'Computer System Architecture', credit_hours: 3, requirement_type: 'Required' },
    { course_id: '1502412', course_name: 'Parallel and Distributed Processing', credit_hours: 3, requirement_type: 'Elective' },
  ],
}

// -- options ----------------------------------------------------------------------

test('a successful options reply is parsed: program, plan version and both course lists', () => {
  const options = parseCourseEquivalencyOptions(OK_PAYLOAD)
  assert.equal(options.status, 'ok')
  assert.deepEqual(options.program, {
    programId: '1502',
    programName: 'Bachelor of Science in Computer Engineering',
    planVersion: 'CPE-WEB-2026-10-31',
    programChangeRequestId: 'STUD_CPSR_CHP3_000123',
  })
  assert.deepEqual(options.oldCourses.map((c) => c.id), ['1440131', '1501215'])   // sorted by ID
  assert.deepEqual(options.newCourses.map((c) => c.id), ['1502326', '1502412'])
})

test('every blocked status is kept, with the program when the database sends one', () => {
  for (const status of ['not_registered_student', 'no_approved_program_change', 'program_change_in_progress',
    'program_change_record_inconsistent'] as const) {
    const options = parseCourseEquivalencyOptions({ status, program: null, old_courses: [], new_courses: [] })
    assert.equal(options.status, status)
    assert.equal(options.program, null)
    assert.deepEqual(options.oldCourses, [])
    assert.deepEqual(options.newCourses, [])
  }
  const noPlan = parseCourseEquivalencyOptions({
    status: 'study_plan_unavailable',
    program: { program_id: '0101', program_name: 'Bachelor of Arts in X' },
    old_courses: [],
    new_courses: [],
  })
  assert.equal(noPlan.status, 'study_plan_unavailable')
  assert.equal(noPlan.program?.programName, 'Bachelor of Arts in X')
})

test('a malformed reply is "unexpected", never shown raw', () => {
  for (const bad of [null, 'ok', [], {}, { status: 'hacked' }, { status: 'ok' },
    { ...OK_PAYLOAD, program: null }, { ...OK_PAYLOAD, old_courses: 'x' },
    { ...OK_PAYLOAD, program: { ...OK_PAYLOAD.program, plan_version: null } }]) {
    assert.equal(parseCourseEquivalencyOptions(bad).status, 'unexpected')
  }
})

test('every non-ok status has a blocked-state message', () => {
  const statuses: Exclude<OptionsStatus, 'ok'>[] = ['not_registered_student', 'no_approved_program_change',
    'program_change_in_progress', 'program_change_record_inconsistent', 'study_plan_unavailable', 'signed_out',
    'unexpected']
  for (const status of statuses) {
    assert.ok(BLOCKED_MESSAGES[status].title.trim(), status)
    assert.ok(BLOCKED_MESSAGES[status].text.trim(), status)
  }
  assert.match(BLOCKED_MESSAGES.no_approved_program_change.text, /approved/)
  assert.match(BLOCKED_MESSAGES.program_change_in_progress.text, /in progress/)
})

// -- course lists ------------------------------------------------------------------

test('completed courses with any recorded grade are offered, including F; a row without a grade is not', () => {
  const options = parseCourseEquivalencyOptions({
    ...OK_PAYLOAD,
    old_courses: [
      ...OK_PAYLOAD.old_courses,
      { course_id: '0000001', course_name: 'Low', credit_hours: 3, grade: 'C', term: 202310 },
      { course_id: '0000002', course_name: 'Failed', credit_hours: 3, grade: 'F', term: 202310 },
      { course_id: '0000004', course_name: 'Pass', credit_hours: 3, grade: 'D', term: 202310 },
      { course_id: '0000003', course_name: 'No grade', credit_hours: 3, grade: null, term: 202310 },
      { course_id: '0000005', course_name: 'Blank grade', credit_hours: 3, grade: '  ', term: 202310 },
    ],
  })
  assert.deepEqual(options.oldCourses.map((c) => c.id), ['0000001', '0000002', '0000004', '1440131', '1501215'])
  assert.deepEqual(options.oldCourses.map((c) => c.grade), ['C', 'F', 'D', 'C+', 'B+'])
  assert.equal(completedCourseOptions(options.oldCourses)[1].detail, 'Best grade F · Term 202310')
})

test('the picker shows each completed course with its best grade and term', () => {
  const options = parseCourseEquivalencyOptions(OK_PAYLOAD)
  const picker = completedCourseOptions(options.oldCourses)
  assert.deepEqual(picker.find((c) => c.id === '1501215'), {
    id: '1501215', name: 'Data Structures', creditHours: 3, detail: 'Best grade B+ · Term 202410',
  })
  assert.equal(completedCourseOptions([{ id: '1', name: null, creditHours: null, grade: 'A', term: null }])[0].detail,
    'Best grade A')
})

test('the requested-course picker offers exactly the study-plan courses the database returned (passed ones included)', () => {
  const options = parseCourseEquivalencyOptions(OK_PAYLOAD)
  const picker = planCourseOptions(options.newCourses)
  assert.deepEqual(picker.map((c) => c.id), ['1502326', '1502412'])
  assert.equal(picker[0].detail, 'Required course')
  assert.equal(picker[1].detail, 'Elective course')
  assert.equal(planCourseOptions([{ id: '9', name: null, creditHours: null, requirementType: null }])[0].detail, null)
})

// -- form ---------------------------------------------------------------------------

test('the reason is required and at most 1000 characters after trimming; no minimum', () => {
  assert.equal(REASON_MAX_LENGTH, 1000)
  assert.match(reasonError('   ') ?? '', /Explain why/)
  assert.equal(reasonError(`  ${'x'.repeat(19)}  `), null)
  assert.equal(reasonError('x'), null)
  assert.equal(reasonError('x'.repeat(1000)), null)
  assert.match(reasonError('x'.repeat(1001)) ?? '', /at most 1000/)
  // A legacy minimum refusal from the database names no length.
  assert.doesNotMatch(SUBMIT_ERROR_MESSAGES.reason_too_short, /\d/)
})

test('both courses are required and must differ', () => {
  const ok = { oldCourseId: '1501215', newCourseId: '1502326', reason: 'x'.repeat(25) }
  assert.deepEqual(validateCourseEquivalencyForm(ok), {})
  assert.ok(validateCourseEquivalencyForm({ ...ok, oldCourseId: null }).oldCourse)
  assert.ok(validateCourseEquivalencyForm({ ...ok, newCourseId: null }).newCourse)
  assert.match(validateCourseEquivalencyForm({ ...ok, newCourseId: ok.oldCourseId }).newCourse ?? '', /different/)
  assert.ok(validateCourseEquivalencyForm({ ...ok, reason: '   ' }).reason)
  assert.deepEqual(validateCourseEquivalencyForm({ ...ok, reason: 'short' }), {})   // no minimum length
})

// -- submission errors -------------------------------------------------------------

test('every refusal code of submit_course_equivalency_request maps to its own message', () => {
  for (const code of ['not_registered_student', 'reason_required', 'reason_too_short', 'reason_too_long',
    'no_approved_program_change', 'program_change_in_progress', 'program_change_record_inconsistent',
    'study_plan_unavailable', 'old_course_not_found', 'new_course_not_found', 'same_course',
    'old_course_not_completed', 'old_course_grade_below_minimum', 'new_course_not_in_study_plan',
    'new_course_already_passed', 'duplicate_request'] as const) {
    assert.equal(submitErrorCode({ message: code }), code)
    assert.ok(SUBMIT_ERROR_MESSAGES[code].trim())
  }
})

test('raw database text is never shown; an ended session is recognised', () => {
  assert.equal(submitErrorCode({ message: 'new row violates row-level security policy for table "Request"' }), 'unknown')
  assert.equal(submitErrorCode({ message: 'program_context_mismatch' }), 'unknown')
  assert.equal(submitErrorCode(null), 'unknown')
  assert.equal(submitErrorCode({ message: 'JWT expired', code: 'PGRST301' }), 'signed_out')
  assert.equal(submitErrorCode({ message: 'permission denied for function submit_course_equivalency_request' }), 'signed_out')
  for (const message of Object.values(SUBMIT_ERROR_MESSAGES)) {
    assert.doesNotMatch(message, /\bselect\b.+\bfrom\b|insert into|relation "|function \w+\(|\bsql\b|row-level|policy/i)
  }
})

test('refusals that mean the options changed make the page reload them', () => {
  assert.ok(RELOAD_OPTIONS_CODES.has('program_change_in_progress'))
  assert.ok(RELOAD_OPTIONS_CODES.has('new_course_already_passed'))
  assert.ok(!RELOAD_OPTIONS_CODES.has('duplicate_request'))
  assert.ok(!RELOAD_OPTIONS_CODES.has('reason_too_short'))
})

// -- request details ---------------------------------------------------------------

test('a request with stored program context shows it', () => {
  const fields = courseEquivalencyContextFields({
    Program_Change_Request_ID: 'STUD_CPSR_CHP3_000123',
    Old_Program_ID: '1501', Old_Program_Name: 'Bachelor of Science in Computer Science',
    New_Program_ID: '1502', New_Program_Name: 'Bachelor of Science in Computer Engineering',
    Plan_Version: 'CPE-WEB-2026-10-31', Old_Course_Grade: 'B+', Old_Course_Term: 202410,
  })
  assert.deepEqual(fields, [
    { label: 'Previous program', value: '1501 · Bachelor of Science in Computer Science' },
    { label: 'New program', value: '1502 · Bachelor of Science in Computer Engineering' },
    { label: 'Study plan version', value: 'CPE-WEB-2026-10-31' },
    { label: 'Grade in completed course', value: 'B+ · Term 202410' },
    { label: 'Approved Program Change', value: 'STUD_CPSR_CHP3_000123' },
  ])
})

test('a legacy request (no stored context) shows no context field at all', () => {
  assert.deepEqual(courseEquivalencyContextFields({
    Program_Change_Request_ID: null, Old_Program_ID: null, Old_Program_Name: null, New_Program_ID: null,
    New_Program_Name: null, Plan_Version: null, Old_Course_Grade: null, Old_Course_Term: null,
  }), [])
  assert.deepEqual(courseEquivalencyContextFields({}), [])
})

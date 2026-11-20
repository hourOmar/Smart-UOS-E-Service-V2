// The student Course Substitution form: route, catalog entry and static
// guarantees (data only through the service, one submission at a time, the
// exact database call, no student ID sent). Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { academicRequestTypes } from '../src/data/academicRequests.ts'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const APP = source('../src/App.tsx')
const PAGE = source('../src/pages/CourseSubstitutionForm.tsx')
const COMBO = source('../src/components/courseEquivalency/CourseCombobox.tsx')
const HOOK = source('../src/hooks/useCourseSubstitutionData.ts')
const SERVICE = source('../src/services/courseSubstitution.ts')

test('the student route exists and is protected for students', () => {
  assert.match(APP, /path="\/student\/services\/course-substitution\/new"\s+element=\{\s+<ProtectedRoute requiredRole="student">\s+<CourseSubstitutionForm \/>/)
})

test('the catalog entry starts the form and has its details filled in', () => {
  const entry = academicRequestTypes.find((r) => r.id === 'course-substitution')
  assert.ok(entry)
  assert.equal(entry.startPath, '/student/services/course-substitution/new')
  const { details } = entry
  for (const field of ['description', 'audience', 'requirements'] as const) {
    assert.notEqual(details[field].trim(), '', `${field} must not be empty`)
  }
  assert.equal(details.steps.length, 5)
  assert.ok(details.checklist.includes('Prepare a clear reason for your request.'))
  assert.equal(details.supportingDocuments, 'None.')
  assert.equal(details.requiredDocuments.length, 1)
  assert.match(details.requiredDocuments[0], /No documents are needed for this request\./)
})

test('the page and picker use only the data layer (no direct Supabase, fetch or token)', () => {
  for (const [name, text] of Object.entries({ PAGE, COMBO, HOOK })) {
    for (const forbidden of [/\bsupabase\b/, /\bfetch\(/, /access_token/, /getSession/, /console\./, /localStorage/,
      /\.rpc\(/, /service_role/i]) {
      assert.doesNotMatch(text, forbidden, `${name} must not match ${forbidden}`)
    }
  }
  assert.match(PAGE, /useCourseSubstitutionData\(\)/)
  assert.match(PAGE, /await submitCourseSubstitutionRequest\(originalId, proposedId, reason\)/)
})

test('the service calls only the two database functions, with no student ID', () => {
  assert.equal(SERVICE.match(/\.rpc\(/g)?.length, 2)
  // Options: no arguments at all (the student comes from the session).
  assert.match(SERVICE, /supabase\.rpc\('get_my_course_substitution_options'\)/)
  // No direct table reads: students cannot read the study plan, and the old
  // whole-catalog list (public."Course") is gone.
  assert.doesNotMatch(SERVICE, /\.from\(/)
  assert.match(SERVICE, /supabase\.rpc\('submit_course_substitution_request', \{\s+p_original_course_id: originalCourseId,\s+p_proposed_course_id: proposedCourseId,\s+p_reason: reason\.trim\(\),\s+\}\)/)
  const submit = SERVICE.slice(SERVICE.indexOf('export async function submitCourseSubstitutionRequest'))
  assert.doesNotMatch(submit, /student_id|Student_ID|studentId/i)
  assert.doesNotMatch(SERVICE, /\.(insert|update|upsert|delete)\(/)
})

test('duplicate submissions are prevented and the form is locked while submitting', () => {
  assert.match(PAGE, /if \(submittingRef\.current\) return\s+setAttempted\(true\)/)
  assert.match(PAGE, /submittingRef\.current = true/)
  assert.match(PAGE, /submittingRef\.current = false/)
  assert.match(PAGE, /disabled=\{submitting\}\s+aria-busy=\{submitting \|\| undefined\}/)
  assert.match(PAGE, /if \(!originalId \|\| !proposedId \|\| Object\.keys\(errors\)\.length > 0\) return/)
})

test('the proposed course can never be the original course', () => {
  assert.match(PAGE, /excludedId=\{originalId\}/)
  assert.match(PAGE, /if \(proposedId === id\) setProposedId\(null\)/)
  assert.match(COMBO, /comboboxCourses\(courses, query, excludedId\)/)
})

test('both dropdowns are the searchable combobox, fed by the study-plan options', () => {
  assert.match(PAGE, /import CourseCombobox from '\.\.\/components\/courseEquivalency\/CourseCombobox'/)
  assert.doesNotMatch(PAGE, /CoursePicker/)
  assert.match(PAGE, /placeholder="Search or select the course to replace"\s+courses=\{originalCourses\}\s+selectedId=\{originalId\}\s+onSelect=\{chooseOriginal\}/)
  assert.match(PAGE, /placeholder="Search or select the course to take instead"\s+courses=\{proposedCourses\}\s+selectedId=\{proposedId\}\s+excludedId=\{originalId\}/)
  assert.match(PAGE, /const originalCourses = options\?\.originalCourses \?\? \[\]/)
  assert.match(PAGE, /const proposedCourses = options\?\.proposedCourses \?\? \[\]/)
  assert.match(HOOK, /fetchCourseSubstitutionOptions\(\)/)
})

test('loading, load errors, blocked statuses and empty lists each have their own state', () => {
  assert.match(PAGE, /status === 'loading' &&/)
  assert.match(PAGE, /status === 'error' &&[\s\S]*?onClick=\{retry\}/)
  // No student record, no study plan for the program, or an unreadable reply.
  assert.match(PAGE, /status === 'ready' && options && options\.status !== 'ok' &&/)
  assert.match(PAGE, /\{BLOCKED_MESSAGES\[options\.status\]\.title\}/)
  assert.match(PAGE, /options\.status === 'study_plan_unavailable' && options\.program &&/)
  // Either list empty: a message instead of the form; the form needs both.
  assert.match(PAGE, /\{originalCourses\.length === 0 \? NO_ORIGINAL_COURSES : NO_PROPOSED_COURSES\}/)
  assert.match(PAGE, /options\?\.status === 'ok' && originalCourses\.length > 0 && proposedCourses\.length > 0 &&/)
})

test('page text: the new description; no study-plan version line and no helper lines under the course fields', () => {
  assert.match(PAGE, /Request to replace a course in your study plan with another course\./)
  assert.doesNotMatch(PAGE, /Request that another University of Sharjah course count in place of a course in your plan/)
  assert.doesNotMatch(PAGE, /Study plan version|planVersion/)
  assert.doesNotMatch(PAGE, /hint=/)
  assert.doesNotMatch(PAGE, /have not passed and are not taking now/)
  // The program name stays.
  assert.match(PAGE, /\{options\.program\.programName\}/)
})

test('the dropdown renders a helper line only when one is given', () => {
  assert.match(COMBO, /hint\?: string/)
  assert.match(COMBO, /\{hint && \(\s+<span id=\{`\$\{id\}-hint`\} className="csf-picker__hint">/)
  assert.match(COMBO, /\[hint \? `\$\{id\}-hint` : ''/)
})

test('a refusal meaning the options changed reloads them and clears both choices', () => {
  assert.match(PAGE, /if \(error instanceof CourseSubstitutionSubmitError && RELOAD_OPTIONS_CODES\.has\(error\.code\)\) \{\s+setOriginalId\(null\)\s+setProposedId\(null\)\s+retry\(\)/)
})

test('refusals are shown as the mapped message only', () => {
  assert.match(PAGE, /error instanceof CourseSubstitutionSubmitError\s+\? error\.message\s+: new CourseSubstitutionSubmitError\('unknown'\)\.message/)
  assert.match(SERVICE, /throw new CourseSubstitutionSubmitError\(submitErrorCode\(error\)\)/)
})

test('success shows the Request ID and a link to the request', () => {
  assert.match(PAGE, /<span className="rc-done__id">\{submitted\.id\}<\/span>/)
  assert.match(PAGE, /navigate\(requestDetailsPath\(submitted\.id\)\)/)
})

test('the reason field enforces the maximum and shows a counter', () => {
  assert.match(PAGE, /maxLength=\{REASON_MAX_LENGTH\}/)
  assert.match(PAGE, /\{reason\.length\} \/ \{REASON_MAX_LENGTH\}/)
})

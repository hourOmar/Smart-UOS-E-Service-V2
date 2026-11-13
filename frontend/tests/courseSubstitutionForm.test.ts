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
const PICKER = source('../src/components/courseSubstitution/CoursePicker.tsx')
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
  assert.ok(details.checklist.some((item) => item.includes('at least 20 characters')))
  assert.match(details.supportingDocuments, /No documents are requested/)
  assert.equal(details.requiredDocuments.length, 1)
  assert.match(details.requiredDocuments[0], /No documents are requested/)
})

test('the page and picker use only the data layer (no direct Supabase, fetch or token)', () => {
  for (const [name, text] of Object.entries({ PAGE, PICKER, HOOK })) {
    for (const forbidden of [/\bsupabase\b/, /\bfetch\(/, /access_token/, /getSession/, /console\./, /localStorage/,
      /\.rpc\(/, /service_role/i]) {
      assert.doesNotMatch(text, forbidden, `${name} must not match ${forbidden}`)
    }
  }
  assert.match(PAGE, /useCourseSubstitutionData\(\)/)
  assert.match(PAGE, /await submitCourseSubstitutionRequest\(originalId, proposedId, reason\)/)
})

test('the submission calls only submit_course_substitution_request, with the three arguments and no student ID', () => {
  assert.equal(SERVICE.match(/\.rpc\(/g)?.length, 1)
  assert.match(SERVICE, /supabase\.rpc\('submit_course_substitution_request', \{\s+p_original_course_id: originalCourseId,\s+p_proposed_course_id: proposedCourseId,\s+p_reason: reason\.trim\(\),\s+\}\)/)
  const submit = SERVICE.slice(SERVICE.indexOf('export async function submitCourseSubstitutionRequest'))
  assert.doesNotMatch(submit, /student_id|Student_ID|studentId/i)
  // The service only reads public."Course" and the account's own Student row.
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
  assert.match(PICKER, /courses\.filter\(\(course\) => course\.id !== excludedId\)/)
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

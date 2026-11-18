// The student Course Equivalency form: route, catalog entry, data layer, the
// exact database calls, duplicate-click prevention, navigation after success,
// blocked states, request details, and that Course Substitution is unchanged.
// Static checks of the sources (no browser, backend or database). Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { academicRequestTypes } from '../src/data/academicRequests.ts'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const APP = source('../src/App.tsx')
const PAGE = source('../src/pages/CourseEquivalencyForm.tsx')
const HOOK = source('../src/hooks/useCourseEquivalencyOptions.ts')
const SERVICE = source('../src/services/courseEquivalency.ts')
const DETAILS = source('../src/services/studentRequests.ts')
const COMBO = source('../src/components/courseEquivalency/CourseCombobox.tsx')
const CS_PAGE = source('../src/pages/CourseSubstitutionForm.tsx')
const CS_SERVICE = source('../src/services/courseSubstitution.ts')

test('the student route exists and is protected for students', () => {
  assert.match(APP, /path="\/student\/services\/course-equivalency\/new"\s+element=\{\s+<ProtectedRoute requiredRole="student">\s+<CourseEquivalencyForm \/>/)
})

test('the catalog card starts the form and no longer says the course came from another institution', () => {
  const entry = academicRequestTypes.find((r) => r.id === 'course-equivalency')
  assert.ok(entry)
  assert.equal(entry.startPath, '/student/services/course-equivalency/new')
  assert.doesNotMatch(entry.description, /another institution|external/i)
  assert.match(entry.description, /program change/i)
})

test('the page and hook use only the data layer (no direct Supabase, fetch, token or storage)', () => {
  for (const [name, text] of Object.entries({ PAGE, HOOK })) {
    for (const forbidden of [/\bsupabase\b/, /\bfetch\(/, /access_token/, /getSession/, /console\./, /localStorage/,
      /\.rpc\(/, /service_role/i, /Program_ID/]) {
      assert.doesNotMatch(text, forbidden, `${name} must not match ${forbidden}`)
    }
  }
  assert.match(PAGE, /useCourseEquivalencyOptions\(\)/)
  assert.match(PAGE, /await submitCourseEquivalencyRequest\(oldCourseId, newCourseId, reason\)/)
})

test('the service calls exactly the two database functions, with the exact parameter names and no student ID', () => {
  assert.equal(SERVICE.match(/\.rpc\(/g)?.length, 2)
  assert.match(SERVICE, /supabase\.rpc\('get_my_course_equivalency_options'\)/)
  assert.match(SERVICE, /supabase\.rpc\('submit_course_equivalency_request', \{\s+p_old_course_id: oldCourseId,\s+p_new_course_id: newCourseId,\s+p_reason: reason\.trim\(\),\s+\}\)/)
  assert.doesNotMatch(SERVICE, /student_id|Student_ID|studentId/i)
  assert.doesNotMatch(SERVICE, /\.from\(|\.(insert|update|upsert|delete)\(/)
  // The Request_ID is returned only after the database confirmed it.
  assert.match(SERVICE, /if \(error\) throw new CourseEquivalencySubmitError\(submitErrorCode\(error\)\)/)
  assert.match(SERVICE, /if \(typeof data !== 'string' \|\| data\.trim\(\) === ''\) throw new CourseEquivalencySubmitError\('unknown'\)/)
})

test('duplicate submissions are prevented and the form is locked while submitting', () => {
  assert.match(PAGE, /if \(submittingRef\.current\) return\s+setAttempted\(true\)/)
  assert.match(PAGE, /submittingRef\.current = true/)
  assert.match(PAGE, /submittingRef\.current = false/)
  assert.match(PAGE, /disabled=\{submitting\}\s+aria-busy=\{submitting \|\| undefined\}/)
  assert.match(PAGE, /if \(!oldCourseId \|\| !newCourseId \|\| Object\.keys\(errors\)\.length > 0\) return/)
  assert.match(PAGE, /\{submitting \? 'Submitting…' : 'Submit Request'\}/)
})

test('success navigates to the new request with the Request_ID the database returned', () => {
  const tryBlock = PAGE.slice(PAGE.indexOf('try {'), PAGE.indexOf('} catch (error)'))
  assert.match(tryBlock, /const requestId = await submitCourseEquivalencyRequest\(/)
  assert.match(tryBlock, /navigate\(requestDetailsPath\(requestId\)\)/)
  assert.ok(tryBlock.indexOf('await submitCourseEquivalencyRequest') < tryBlock.indexOf('navigate('))
})

test('submission errors are shown as messages, and stale options are reloaded', () => {
  assert.match(PAGE, /setSubmitError\(failure\.message\)/)
  assert.match(PAGE, /if \(RELOAD_OPTIONS_CODES\.has\(failure\.code\)\)/)
  assert.match(PAGE, /<p className="rc-alert" role="alert">/)
})

test('every blocked status shows an explanation instead of the form', () => {
  assert.match(PAGE, /options\.status !== 'ok' \? BLOCKED_MESSAGES\[options\.status\] : null/)
  assert.match(PAGE, /\{blocked\.title\}/)
  assert.match(PAGE, /\{blocked\.text\}/)
  assert.match(PAGE, /status === 'ready' && options\?\.status === 'ok' && program &&/)
  // Direct ways back from a blocked state.
  assert.match(PAGE, /<Link to="\/student" className="rc-submit">\s+Back to dashboard/)
  assert.match(PAGE, /state=\{\{ scrollTo: CATALOG_ANCHOR_ID \}\} className="rc-button">\s+Academic requests/)
})

test('the form shows the applicable program and study-plan version, the best grade and the requirement type', () => {
  assert.match(PAGE, /\{program\.programName\}/)
  assert.match(PAGE, /Study plan version \{program\.planVersion\}/)
  assert.match(PAGE, /completedCourseOptions\(options\?\.oldCourses \?\? \[\]\)/)
  assert.match(PAGE, /planCourseOptions\(options\?\.newCourses \?\? \[\]\)/)
  assert.match(PAGE, /excludedId=\{oldCourseId\}/)
  assert.match(COMBO, /\{course\.detail && <span className="cec-option__detail">\{course\.detail\}<\/span>\}/)
  assert.match(COMBO, /\{hours && <span className="cec-option__hours">\{hours\}<\/span>\}/)
})

test('request details read the stored context and add it only when present', () => {
  assert.match(DETAILS, /'Old_Course_ID, New_Course_ID, Reason, Program_Change_Request_ID, Old_Program_ID, Old_Program_Name, '\s+\+ 'New_Program_ID, New_Program_Name, Plan_Version, Old_Course_Grade, Old_Course_Term'/)
  assert.match(DETAILS, /\.\.\.courseEquivalencyContextFields\(row\)/)
})

test('Course Substitution is unchanged: its page, service and picker contract still work as before', () => {
  assert.match(CS_PAGE, /await submitCourseSubstitutionRequest\(originalId, proposedId, reason\)/)
  assert.match(CS_SERVICE, /supabase\.rpc\('submit_course_substitution_request'/)
  // Course Substitution never sets the picker's optional detail line.
  assert.doesNotMatch(CS_PAGE, /\bdetail:/)
  assert.doesNotMatch(CS_SERVICE, /\bdetail:/)
})

test('the form no longer mentions a C+ minimum or hides passed study-plan courses', () => {
  assert.doesNotMatch(PAGE, /C\+/)
  assert.doesNotMatch(PAGE, /not passed yet|already passed/)
  assert.match(PAGE, /hint="A course from your transcript with a recorded grade \(your best attempt is shown\)\."/)
  assert.match(PAGE, /hint="A course in your new program’s current study plan\."/)
  assert.match(PAGE, /You have no completed course with a recorded grade, so a course equivalency cannot be requested\./)
})

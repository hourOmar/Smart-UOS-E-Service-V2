// Admin search (opens pages directly) and the admin Student Profile.
// Pure rules are tested directly; the wiring with static checks (no browser,
// backend or database). All rows below are synthetic. Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { classifySearchInput, isSignedOutError, SEARCH_MESSAGES } from '../src/utils/adminSearch.ts'
import { fromStudentProfile, reviewPathFor, studentProfilePath } from '../src/utils/adminPaths.ts'
import {
  filterRequestHistory,
  groupTranscript,
  historyStatusOptions,
  sortRequestHistory,
  summarizeRequests,
  type HistoryRequest,
  type TranscriptEntry,
} from '../src/utils/studentProfile.ts'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const SEARCH = source('../src/components/admin/AdminSearch.tsx')
const ADMIN_SERVICE = source('../src/services/adminRequests.ts')
const PROFILE_PAGE = source('../src/pages/AdminStudentProfile.tsx')
const PROFILE_SERVICE = source('../src/services/adminStudentProfile.ts')
const BREADCRUMB = source('../src/components/admin/ReviewBreadcrumb.tsx')
const APP = source('../src/App.tsx')
const DASHBOARD_CSS = source('../src/pages/AdminDashboard.css')
const REVIEW_PAGES = ['AdminRaiseCapacityReview', 'AdminProgramChangeReview', 'AdminIncompleteExamReview',
  'AdminCourseSubstitutionReview'].map((name) => [name, source(`../src/pages/${name}.tsx`)] as const)

// -- search input -------------------------------------------------------------------

test('student and request IDs are recognised by their stored formats, trimmed and upper-cased', () => {
  assert.deepEqual(classifySearchInput('  u21100123 '), { kind: 'student', id: 'U21100123' })
  assert.deepEqual(classifySearchInput('STUD_INCRQ_INC2_000075'), { kind: 'request', id: 'STUD_INCRQ_INC2_000075' })
  assert.deepEqual(classifySearchInput(' stud_rscaq_rsca_000001\t'), { kind: 'request', id: 'STUD_RSCAQ_RSCA_000001' })
  assert.deepEqual(classifySearchInput('   '), { kind: 'empty' })
  for (const value of ['U2110012', 'U211001234', '21100123', 'STUD_INCRQ_000075', 'hello', 'U21100123 x']) {
    assert.equal(classifySearchInput(value).kind, 'invalid', value)
  }
})

test('an expired session is told apart from other failures', () => {
  assert.equal(isSignedOutError({ code: 'PGRST301', message: 'x' }), true)
  assert.equal(isSignedOutError({ message: 'JWT expired' }), true)
  assert.equal(isSignedOutError({ message: 'Failed to fetch' }), false)
  assert.equal(isSignedOutError(null), false)
  assert.match(SEARCH_MESSAGES.noReviewPage('STUD_X_ECTU_000001', 'Course Equivalency'), /don’t have a review page yet/)
})

// -- destinations ---------------------------------------------------------------------

test('each request type opens its existing review page; others have none', () => {
  assert.equal(reviewPathFor('Incomplete Exam', 'STUD_INCRQ_INC2_000075'), '/admin/requests/incomplete-exam/STUD_INCRQ_INC2_000075')
  assert.equal(reviewPathFor('Raise Capacity', 'R1'), '/admin/requests/raise-capacity/R1')
  assert.equal(reviewPathFor('Program Change', 'R2'), '/admin/requests/program-change/R2')
  assert.equal(reviewPathFor('Course Substitution', 'R3'), '/admin/requests/course-substitution/R3')
  assert.equal(reviewPathFor('Course Equivalency', 'R4'), '/admin/requests/course-equivalency/R4')
  assert.equal(reviewPathFor('Appeal', 'R6'), null)       // a type without a review page
  assert.equal(reviewPathFor('toString', 'R5'), null)   // no prototype keys
  assert.equal(studentProfilePath('U21100123'), '/admin/students/U21100123')
})

test('a review page knows it was opened from a student profile only from that state', () => {
  assert.equal(fromStudentProfile({ from: 'student-profile', studentId: 'U21100123' }), 'U21100123')
  assert.equal(fromStudentProfile({ from: 'dashboard' }), null)
  assert.equal(fromStudentProfile({ from: 'student-profile' }), null)
  assert.equal(fromStudentProfile(null), null)
})

// -- request history ------------------------------------------------------------------

const req = (patch: Partial<HistoryRequest> & { id: string }): HistoryRequest => ({
  type: 'Raise Capacity', date: '2026-10-01', time: '10:00:00', status: 'In Progress',
  approvalRecorded: false, decidedAt: null, ...patch,
})

test('history is newest first: date, then time, then ID, all descending; undated last', () => {
  const rows = [
    req({ id: 'A', date: '2026-09-01' }),
    req({ id: 'B', date: '2026-11-03', time: '09:00:00' }),
    req({ id: 'C', date: '2026-11-03', time: '14:05:00' }),
    req({ id: 'D', date: null }),
    req({ id: 'E', date: '2026-11-03', time: '14:05:00' }),
    req({ id: 'F', date: '2026-10-15' }),
  ]
  assert.deepEqual(sortRequestHistory(rows).map((r) => r.id), ['E', 'C', 'B', 'F', 'A', 'D'])
  // Stable: the same order whatever the input order.
  assert.deepEqual(sortRequestHistory([...rows].reverse()).map((r) => r.id), ['E', 'C', 'B', 'F', 'A', 'D'])
})

test('filters keep the newest-first order and include every request type', () => {
  const sorted = sortRequestHistory([
    req({ id: 'STUD_A_ECTU_000001', type: 'Course Equivalency', date: '2026-11-01' }),
    req({ id: 'STUD_A_RSCA_000002', date: '2026-11-02', status: 'Completed' }),
    req({ id: 'STUD_A_RSCA_000003', date: '2026-10-02' }),
  ])
  assert.deepEqual(filterRequestHistory(sorted, { type: null, status: null, query: '' }).map((r) => r.id),
    ['STUD_A_RSCA_000002', 'STUD_A_ECTU_000001', 'STUD_A_RSCA_000003'])
  assert.deepEqual(filterRequestHistory(sorted, { type: 'Raise Capacity', status: null, query: '' }).map((r) => r.id),
    ['STUD_A_RSCA_000002', 'STUD_A_RSCA_000003'])
  assert.deepEqual(filterRequestHistory(sorted, { type: null, status: 'Approved', query: '' }).map((r) => r.id),
    ['STUD_A_RSCA_000002'])
  assert.deepEqual(filterRequestHistory(sorted, { type: null, status: null, query: ' ectu ' }).map((r) => r.id),
    ['STUD_A_ECTU_000001'])
})

test('summary counts follow the app\'s status rules: Completed is not always Approved', () => {
  const rows = [
    req({ id: '1', type: 'Raise Capacity', status: 'Completed' }),                        // approved
    req({ id: '2', type: 'Program Change', status: 'Completed' }),                        // approved
    req({ id: '3', type: 'Incomplete Exam', status: 'Completed', approvalRecorded: true }), // approved
    req({ id: '4', type: 'Incomplete Exam', status: 'Completed' }),                       // no approval record
    req({ id: '5', type: 'Course Substitution', status: 'Completed' }),                   // no approval record
    req({ id: '6', type: 'Program Change', status: 'Rejected' }),
    req({ id: '7', type: 'Course Equivalency', status: 'In Progress' }),
    req({ id: '8', type: 'Incomplete Exam', status: 'In Progress' }),
  ]
  assert.deepEqual(summarizeRequests(rows), { total: 8, inProgress: 2, approved: 3, rejected: 1, completedUnconfirmed: 2 })
  assert.deepEqual(summarizeRequests([]), { total: 0, inProgress: 0, approved: 0, rejected: 0, completedUnconfirmed: 0 })
  assert.deepEqual(historyStatusOptions(rows), ['In Progress', 'Approved', 'Completed', 'Rejected'])
})

// -- transcript -------------------------------------------------------------------------

test('the transcript keeps every row, most recent term first, and marks repeated courses', () => {
  const entry = (patch: Partial<TranscriptEntry> & { courseId: string; term: number }): TranscriptEntry => ({
    courseName: null, creditHours: 3, sectionId: '11', grade: 'B', ...patch,
  })
  const terms = groupTranscript([
    entry({ courseId: 'MATH101', term: 202501, grade: 'F' }),
    entry({ courseId: 'CS201', term: 202601, grade: null }),
    entry({ courseId: 'MATH101', term: 202502, grade: 'C+' }),
    entry({ courseId: 'ARAB100', term: 202601 }),
  ])
  assert.deepEqual(terms.map((t) => t.term), [202601, 202502, 202501])
  assert.deepEqual(terms[0].courses.map((c) => c.courseId), ['ARAB100', 'CS201'])
  assert.equal(terms[0].courses[1].grade, null)                 // no grade stays null (never invented)
  assert.deepEqual(terms.flatMap((t) => t.courses).filter((c) => c.repeated).map((c) => `${c.courseId}/${c.term}/${c.grade}`),
    ['MATH101/202502/C+', 'MATH101/202501/F'])
  assert.equal(terms.flatMap((t) => t.courses).length, 4)
  assert.deepEqual(groupTranscript([]), [])
})

// -- wiring ---------------------------------------------------------------------------------

test('the dashboard search opens pages directly and shows no preview card', () => {
  assert.doesNotMatch(SEARCH, /SearchMatch|adm-match|RequestStatusBadge|kind: 'found'/)
  assert.doesNotMatch(DASHBOARD_CSS, /adm-match/)
  assert.doesNotMatch(ADMIN_SERVICE, /searchStudentOrRequest|StudentMatch|RequestMatch/)
  assert.match(SEARCH, /navigate\(studentProfilePath\(target\.studentId\)\)/)
  assert.match(SEARCH, /const path = reviewPathFor\(target\.type, target\.requestId\)/)
  assert.match(SEARCH, /navigate\(path, \{ state: \{ from: 'dashboard' \} \}\)/)
  // One search at a time; the button is disabled while searching.
  assert.match(SEARCH, /if \(busyRef\.current\) return/)
  assert.match(SEARCH, /<button type="submit" disabled=\{searching\}>/)
  // Both Enter and the button submit the same form.
  assert.match(SEARCH, /<form role="search" className="adm-search" onSubmit=\{handleSubmit\}/)
})

test('the Student Profile route is staff-only, and existing routes are kept', () => {
  assert.match(APP, /path="\/admin\/students\/:studentId"\s+element=\{\s+<ProtectedRoute requiredRole="admin">\s+<AdminStudentProfile \/>/)
  for (const route of ['/admin', '/admin/requests/raise-capacity/:requestId', '/admin/requests/program-change/:requestId',
    '/admin/requests/incomplete-exam/:requestId', '/admin/requests/course-substitution/:requestId', '/admin/requests/:typeId']) {
    assert.ok(APP.includes(`path="${route}"`), route)
  }
})

test('the profile reads every request of the student, read-only, with the staff session', () => {
  const requests = PROFILE_SERVICE.slice(PROFILE_SERVICE.indexOf('async function loadRequests'))
  assert.match(requests, /\.from\('Request'\)\s+\.select\('Request_ID, Request_Type, Request_Date, Submission_Time, Current_Status'\)\s+\.eq\('Student_ID', studentId\)\n/)
  // No type or status filter: every request, whatever its type or details.
  assert.doesNotMatch(requests.slice(0, requests.indexOf('if (requests.error)')), /\.(eq|in|neq)\('(Request_Type|Current_Status)'/)
  assert.doesNotMatch(PROFILE_SERVICE, /\.(update|insert|upsert|delete|rpc)\(/)
  assert.doesNotMatch(PROFILE_SERVICE + PROFILE_PAGE, /service_role|SERVICE_ROLE/)
  // Official values are shown as stored, never recalculated.
  assert.match(PROFILE_SERVICE, /cgpa: num\(s\.CGPA\)/)
  assert.match(PROFILE_SERVICE, /completedHours: num\(s\.Completed_Hours\)/)
})

test('the page order: student information, transcript, request summary, then the history', () => {
  const body = PROFILE_PAGE.slice(PROFILE_PAGE.indexOf('function ProfileBody'))
  const at = (part: string) => body.indexOf(part)
  assert.ok(at('<StudentInformation') < at('<Transcript') && at('<Transcript') < at('<RequestSummary')
    && at('<RequestSummary') < at('<RequestHistory'))
  assert.match(PROFILE_PAGE, /const sorted = useMemo\(\(\) => sortRequestHistory\(data\.rows\), \[data\.rows\]\)/)
  assert.match(PROFILE_PAGE, /const shown = filterRequestHistory\(sorted, \{ type, status, query \}\)/)
  // View details opens the existing review page, remembering the student.
  assert.match(PROFILE_PAGE, /const state: FromStudentProfile = \{ from: 'student-profile', studentId \}/)
  assert.match(PROFILE_PAGE, /<Link to=\{path\} state=\{state\} className="adm-review">/)
})

test('review pages link the Student ID to the profile, and lead back to it when opened from there', () => {
  for (const [name, page] of REVIEW_PAGES) {
    assert.match(page, /<Link to=\{studentProfilePath\(s\.id\)\} className="adm-mono rv-student-link">/, name)
  }
  assert.match(BREADCRUMB, /const studentId = fromStudentProfile\(location\.state\)/)
  assert.match(BREADCRUMB, /<Link to=\{studentProfilePath\(studentId\)\} className="service-breadcrumb__link">/)
  assert.match(BREADCRUMB, /<Link to=\{adminTypePath\(typeId\)\} className="service-breadcrumb__link">/)
})

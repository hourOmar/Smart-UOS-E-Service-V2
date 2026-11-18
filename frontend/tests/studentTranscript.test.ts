// The student's Academic Transcript on My Profile, and the transcript block
// shared with the admin Student Profile. Pure rules are tested directly; the
// wiring with static checks (no browser, backend or database). Rows are
// synthetic. Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { groupTranscript, knownTermName, termName, type TranscriptEntry } from '../src/utils/studentProfile.ts'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const MY_PROFILE = source('../src/pages/MyProfile.tsx')
const MY_PROFILE_CSS = source('../src/pages/MyProfile.css')
const HOOK = source('../src/hooks/useStudentTranscript.ts')
const STUDENT_SERVICE = source('../src/services/studentProfile.ts')
const ADMIN_SERVICE = source('../src/services/adminStudentProfile.ts')
const ADMIN_PAGE = source('../src/pages/AdminStudentProfile.tsx')
const ADMIN_PAGE_CSS = source('../src/pages/AdminStudentProfile.css')
const DASHBOARD_CSS = source('../src/pages/AdminDashboard.css')
const TERMS = source('../src/components/profile/TranscriptTerms.tsx')
const TERMS_CSS = source('../src/components/profile/TranscriptTerms.css')
const TABLE_CSS = source('../src/components/shared/DataTable.css')

test('term names follow the convention (01 Fall YYYY, 02 Spring YYYY+1, 03 Summer YYYY+1)', () => {
  assert.equal(termName(202601), 'Fall 2026')
  assert.equal(termName(202602), 'Spring 2027')
  assert.equal(termName(202603), 'Summer 2027')
  assert.equal(termName(202501), 'Fall 2025')
  assert.equal(termName(202502), 'Spring 2026')
  assert.equal(knownTermName(202603), 'Summer 2027')
})

test('unknown or invalid term codes are shown as stored, never guessed', () => {
  for (const term of [202600, 202604, 202699, 2026, 20260101, -202601, 202601.5, Number.NaN]) {
    assert.equal(knownTermName(term), null)
    assert.equal(termName(term), `Term ${term}`)
  }
})

test('term blocks are newest first, so Spring 2027 comes before Fall 2026', () => {
  const entry = (courseId: string, term: number, grade: string | null): TranscriptEntry => ({
    courseId,
    courseName: null,
    creditHours: 3,
    term,
    sectionId: '1',
    grade,
  })
  const terms = groupTranscript([entry('1501101', 202601, 'A'), entry('1501102', 202602, null)])
  assert.deepEqual(
    terms.map((t) => termName(t.term)),
    ['Spring 2027', 'Fall 2026'],
  )
  assert.equal(terms[0].courses[0].grade, null)
  assert.deepEqual(groupTranscript([]), [])
})

test('the student transcript uses only the Student_ID of their own record', () => {
  // The record is read by Auth UID, never by a value from the page.
  assert.match(STUDENT_SERVICE, /\.eq\('Auth_User_ID', user\.id\)/)
  assert.match(MY_PROFILE, /<AcademicTranscript studentId=\{profile\.studentId\} \/>/)
  for (const file of [MY_PROFILE, HOOK]) {
    assert.doesNotMatch(file, /useParams|useSearchParams|location\.search|<input/)
  }
  assert.match(HOOK, /loadTranscript\(studentId\)/)
})

test('the existing transcript query is reused, read-only', () => {
  assert.match(HOOK, /import \{ loadTranscript \} from '\.\.\/services\/adminStudentProfile'/)
  assert.match(ADMIN_SERVICE, /export async function loadTranscript\(studentId: string\)/)
  assert.match(ADMIN_SERVICE, /from\('Takes'\)\.select\('Course_ID, Section_ID, Term, Grade'\)\.eq\('Student_ID', studentId\)/)
  for (const file of [HOOK, TERMS, MY_PROFILE]) {
    assert.doesNotMatch(file, /\.(update|insert|upsert|delete|rpc)\(/)
    assert.doesNotMatch(file, /service_role|SERVICE_ROLE/)
  }
})

test('transcript loading, errors and retry are independent of the profile', () => {
  // Its own hook and retry; the profile's own states are unchanged.
  assert.match(MY_PROFILE, /const \{ status, entries, retry \} = useStudentTranscript\(studentId\)/)
  assert.match(MY_PROFILE, /Loading your transcript…/)
  assert.match(MY_PROFILE, /We couldn’t load your transcript\./)
  assert.match(MY_PROFILE, /\{status === 'ready' && profile && <ProfileBody profile=\{profile\} \/>\}/)
  assert.doesNotMatch(HOOK, /useStudentProfileDetails|fetchStudentProfileDetails/)
  // A failure becomes the transcript's own error state, never a thrown error.
  assert.match(HOOK, /\.catch\(\(\) => \{\n\s+if \(!cancelled\) setLoaded\(\{ forKey: key, status: 'error', entries: \[\] \}\)/)
})

test('the transcript panel sits below the information cards, full width', () => {
  const body = MY_PROFILE.slice(MY_PROFILE.indexOf('function ProfileBody'))
  const panels = body.indexOf('<div className="profile-panels">')
  const transcript = body.indexOf('<AcademicTranscript')
  assert.ok(panels > -1 && transcript > panels, 'transcript follows the information cards')
  assert.ok(transcript > body.indexOf('</div>', panels), 'transcript is outside the two-column grid')
  assert.match(MY_PROFILE, /termTitle=\{termName\}/)
})

test('both profiles render the shared block; the admin keeps its labels', () => {
  assert.match(MY_PROFILE, /import TranscriptTerms from '\.\.\/components\/profile\/TranscriptTerms'/)
  assert.match(ADMIN_PAGE, /import TranscriptTerms from '\.\.\/components\/profile\/TranscriptTerms'/)
  assert.match(ADMIN_PAGE, /<TranscriptTerms entries=\{part\.data\} emptyMessage="No courses are recorded for this student\." \/>/)
  assert.doesNotMatch(ADMIN_PAGE, /termTitle=|tableClassName=/)
  assert.match(TERMS, /const defaultTermTitle = \(term: number\) => `Term \$\{term\}`/)
  for (const text of ['Repeated', 'No grade recorded', 'Course code', 'Course name', 'Credit hours', 'Section', 'Grade']) {
    assert.ok(TERMS.includes(text), `shared block shows "${text}"`)
  }
  assert.doesNotMatch(ADMIN_PAGE, /className="sp-term"/)
})

test('styles: only the table base and transcript rules are shared', () => {
  // The student page loads no admin page stylesheet.
  assert.doesNotMatch(MY_PROFILE, /import '\.\/Admin[A-Za-z]*\.css'/)
  assert.match(TERMS, /import '\.\.\/shared\/DataTable\.css'/)
  assert.match(TERMS, /import '\.\/TranscriptTerms\.css'/)
  // The admin pages keep the same rules: moved, not changed.
  assert.match(DASHBOARD_CSS, /@import '\.\.\/components\/shared\/DataTable\.css';/)
  assert.doesNotMatch(DASHBOARD_CSS, /^\.adm-table \{|^\.adm-mono \{|^\.adm-table-wrap \{/m)
  assert.match(TABLE_CSS, /\.adm-table \{\n {2}width: 100%;\n {2}min-width: 920px;/)
  assert.doesNotMatch(ADMIN_PAGE_CSS, /^\.sp-(term|tag|grade|code) /m)
  assert.match(TERMS_CSS, /\.sp-tag \{/)
  // The narrower student table is scoped to its own class.
  assert.match(MY_PROFILE_CSS, /\.adm-table\.profile-transcript__table \{\n {2}min-width: 600px;/)
})

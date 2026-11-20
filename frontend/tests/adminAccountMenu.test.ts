// The admin account menu: name, email and Sign Out only (no "Admin home" link).
// Students keep My Profile and My Requests. Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const ADMIN_PAGES = ['AdminDashboard', 'AdminTypeRequests', 'AdminStudentProfile', 'AdminRaiseCapacityReview',
  'AdminIncompleteExamReview', 'AdminProgramChangeReview', 'AdminCourseEquivalencyReview', 'AdminCourseSubstitutionReview']

test('every admin page passes no menu links (an omitted list would show the student links)', () => {
  for (const name of ADMIN_PAGES) {
    const page = read(`../src/pages/${name}.tsx`)
    assert.equal(page.match(/<StudentLayout\b/g)?.length, 1, name)
    assert.match(page, /<StudentLayout [^>]*homePath=\{ADMIN_HOME_PATH\} menuItems=\{\[\]\}>/, name)
    assert.doesNotMatch(page, /ADMIN_HOME_ITEM/, name)
  }
  assert.doesNotMatch(read('../src/utils/adminPaths.ts'), /ADMIN_HOME_ITEM/)
})

test('the menu keeps the identity and Sign Out; students keep their two links', () => {
  const MENU = read('../src/components/student/AccountMenu.tsx')
  assert.match(MENU, /className="student-account__identity"/)
  assert.match(MENU, /className="student-account__item student-account__item--signout"\s+onClick=\{onSignOut\}/)
  assert.match(MENU, /menuItems = STUDENT_MENU_ITEMS/)
  assert.match(MENU, /\{ to: MY_PROFILE_PATH, label: 'My Profile', icon: 'profile' \},\s+\{ to: MY_REQUESTS_PATH, label: 'My Requests' \},/)
})

test('the admin home route and page are kept', () => {
  assert.match(read('../src/App.tsx'), /<AdminDashboard \/>/)
  assert.match(read('../src/utils/adminPaths.ts'), /export const ADMIN_HOME_PATH = '\/admin'/)
})

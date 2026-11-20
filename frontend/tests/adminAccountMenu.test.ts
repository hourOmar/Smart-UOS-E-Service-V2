// The admin account menu: name, email, All Requests and Sign Out (no "Admin
// home" link, no student links). Students keep My Profile and My Requests.
// Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

// The eight existing admin pages and the new All Requests page.
const ADMIN_PAGES = ['AdminDashboard', 'AdminTypeRequests', 'AdminStudentProfile', 'AdminRaiseCapacityReview',
  'AdminIncompleteExamReview', 'AdminProgramChangeReview', 'AdminCourseEquivalencyReview', 'AdminCourseSubstitutionReview',
  'AdminAllRequests']

test('every admin page passes the admin menu (an omitted list would show the student links)', () => {
  for (const name of ADMIN_PAGES) {
    const page = read(`../src/pages/${name}.tsx`)
    assert.equal(page.match(/<StudentLayout\b/g)?.length, 1, name)
    assert.match(page, /<StudentLayout [^>]*homePath=\{ADMIN_HOME_PATH\} menuItems=\{ADMIN_MENU_ITEMS\}>/, name)
    assert.doesNotMatch(page, /ADMIN_HOME_ITEM|menuItems=\{\[/, name)
  }
  const PATHS = read('../src/utils/adminPaths.ts')
  assert.match(PATHS, /export const ALL_REQUESTS_PATH = `\$\{ADMIN_HOME_PATH\}\/requests`/)
  // Exactly one link: All Requests (rendered above Sign Out by AccountMenu).
  assert.match(PATHS, /export const ADMIN_MENU_ITEMS: AccountMenuItem\[\] = \[\{ to: ALL_REQUESTS_PATH, label: 'All Requests' \}\]/)
  assert.doesNotMatch(PATHS, /ADMIN_HOME_ITEM|'Admin home'/)
})

test('the menu keeps the identity and Sign Out, with page links rendered before Sign Out', () => {
  const MENU = read('../src/components/student/AccountMenu.tsx')
  assert.match(MENU, /className="student-account__identity"/)
  assert.match(MENU, /className="student-account__item student-account__item--signout"\s+onClick=\{onSignOut\}/)
  assert.ok(MENU.indexOf('menuItems.map(') < MENU.indexOf('student-account__item--signout'))
  assert.match(MENU, /menuItems = STUDENT_MENU_ITEMS/)
  assert.match(MENU, /\{ to: MY_PROFILE_PATH, label: 'My Profile', icon: 'profile' \},\s+\{ to: MY_REQUESTS_PATH, label: 'My Requests' \},/)
})

test('the admin home route and page are kept', () => {
  assert.match(read('../src/App.tsx'), /<AdminDashboard \/>/)
  assert.match(read('../src/utils/adminPaths.ts'), /export const ADMIN_HOME_PATH = '\/admin'/)
})

// The same request shows the same final status everywhere: the student
// dashboard and My Requests, the admin lists and search, and the details and
// review pages. Static checks of the wiring (no browser, backend or
// database). Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const STUDENT_SERVICE = source('../src/services/studentRequests.ts')
const ADMIN_SERVICE = source('../src/services/adminRequests.ts')
const REQUEST_LIST = source('../src/components/requests/RequestList.tsx')
const ADMIN_SEARCH = source('../src/components/admin/AdminSearch.tsx')
const PENDING = source('../src/components/admin/PendingRequests.tsx')
const TYPE_REQUESTS = source('../src/pages/AdminTypeRequests.tsx')
const BADGE = source('../src/components/requests/RequestStatusBadge.tsx')

const BADGE_WITH_FLAG = /<RequestStatusBadge\s+status=\{(\w+)\.status\}\s+requestType=\{[\w.]+\}\s+approvalRecorded=\{\1\.approvalRecorded\}\s+\/>/g

test('every list badge passes the row\'s recorded approval, like the details pages', () => {
  assert.equal(REQUEST_LIST.match(BADGE_WITH_FLAG)?.length, 2)   // table and narrow-screen cards
  assert.equal(ADMIN_SEARCH.match(BADGE_WITH_FLAG)?.length, 1)
  assert.equal(PENDING.match(BADGE_WITH_FLAG)?.length, 1)
  assert.equal(TYPE_REQUESTS.match(/<RequestStatusBadge\s+status=\{row\.status\}\s+requestType=\{type\}\s+approvalRecorded=\{row\.approvalRecorded\}\s+\/>/g)?.length, 1)
  for (const file of [REQUEST_LIST, ADMIN_SEARCH, PENDING, TYPE_REQUESTS]) {
    assert.doesNotMatch(file, /<RequestStatusBadge status=\{[\w.]+\} requestType=\{[\w.]+\} \/>/)
  }
  // One badge and one label rule everywhere: the colour follows the stored status.
  assert.match(BADGE, /statusLabel\(status, requestType, approvalRecorded\)/)
})

test('student lists use the student\'s own decision functions, only for rows that need them', () => {
  assert.match(STUDENT_SERVICE, /return withRecordedApprovals\(\(\(data \?\? \[\]\) as RequestRowData\[\]\)\.map\(toRow\)\)/)
  assert.match(STUDENT_SERVICE, /\[INCOMPLETE_EXAM\]: fetchIncompleteExamDecision/)
  assert.match(STUDENT_SERVICE, /\[COURSE_SUBSTITUTION\]: fetchCourseSubstitutionDecision/)
  assert.match(STUDENT_SERVICE, /rows\.filter\(\(row\) => needsApprovalRecord\(row\.status, row\.type\)\)/)
  assert.match(STUDENT_SERVICE, /if \(view\?\.decision === 'approve'\) approved\.add\(row\.id\)/)
  // Students cannot read Decision; a failed lookup keeps the stored status.
  assert.doesNotMatch(STUDENT_SERVICE, /from\('Decision'\)/)
  assert.match(STUDENT_SERVICE, /\} catch \{\s+\/\/ Shown as stored\.\s+\}/)
})

test('admin lists read the approval decisions once per page, and fall back to the stored status', () => {
  const helper = ADMIN_SERVICE.slice(ADMIN_SERVICE.indexOf('async function withRecordedApprovals'))
  assert.match(helper, /rows\.filter\(\(row\) => needsApprovalRecord\(row\.status, row\.type\)\)/)
  assert.match(helper, /\.from\('Decision'\)\s+\.select\('Request_ID, Decision_Type'\)\s+\.in\('Request_ID', needed\.map\(\(row\) => row\.id\)\)\s+\.in\('Decision_Type', Object\.values\(APPROVAL_DECISION_TYPES\)\)/)
  assert.match(helper, /if \(error\) return rows/)
  assert.match(helper, /recordedApprovalIds\(/)
  assert.match(ADMIN_SERVICE, /approvalRecorded: false,/)
  assert.match(ADMIN_SERVICE, /rows: await withRecordedApprovals\(/)
  assert.match(ADMIN_SERVICE, /const \[row\] = await withRecordedApprovals\(\[toAdminRow\(r\)\]\)/)
  // Statuses are only read and labelled, never written.
  assert.doesNotMatch(ADMIN_SERVICE, /\.(update|insert|upsert|delete)\(/)
  assert.doesNotMatch(STUDENT_SERVICE, /\.(update|insert|upsert|delete)\(/)
})

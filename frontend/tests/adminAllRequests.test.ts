// Admin All Requests (/admin/requests) and the admin home's Pending Requests:
// URL state, the badge-matching status filter, the database query, review
// navigation and the dashboard's latest 10. No browser, database or AI.
// Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  ALL_REQUESTS_PAGE_SIZE,
  ALL_REQUEST_TYPES,
  ALWAYS_APPROVED_TYPES,
  DEFAULT_ALL_REQUESTS_FILTERS,
  DISPLAY_STATUSES,
  FILTER_STATUSES,
  RECORDED_APPROVAL_TYPES,
  approvedGroup,
  approvedRequestIds,
  combineOrGroups,
  dateRangeError,
  hasActiveFilters,
  inList,
  parseAllRequestsParams,
  searchTerm,
  statusPlan,
  idSearchGroup,
  toAllRequestsParams,
  validDate,
  type StatusPlan,
} from '../src/utils/adminAllRequests.ts'
import { allRequestsReturnPath } from '../src/utils/adminPaths.ts'
import { statusLabel } from '../src/utils/statusLabels.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const SERVICE = read('../src/services/adminRequests.ts')
const PAGE = read('../src/pages/AdminAllRequests.tsx')
const PENDING = read('../src/components/admin/PendingRequests.tsx')
const DASHBOARD = read('../src/pages/AdminDashboard.tsx')
const APP = read('../src/App.tsx')
const params = (query: string) => new URLSearchParams(query)

// -- URL state -----------------------------------------------------------------------

test('URL: filters, sort and page round-trip; defaults are left out of the URL', () => {
  const filters = {
    ...DEFAULT_ALL_REQUESTS_FILTERS,
    search: 'U211', type: 'Program Change', status: 'Approved' as const,
    from: '2026-01-01', fromTime: '08:30', to: '2026-03-31', toTime: '17:00', term: 202602,
    sort: 'oldest' as const, page: 3,
  }
  const query = toAllRequestsParams(filters).toString()
  assert.equal(query,
    'q=U211&type=Program+Change&status=Approved&from=2026-01-01&fromTime=08%3A30&to=2026-03-31&toTime=17%3A00&term=202602&sort=oldest&page=3')
  assert.deepEqual(parseAllRequestsParams(params(query)), filters)
  assert.equal(toAllRequestsParams(DEFAULT_ALL_REQUESTS_FILTERS).toString(), '')
  assert.deepEqual(parseAllRequestsParams(params('')), DEFAULT_ALL_REQUESTS_FILTERS)
})

test('URL: unknown or malformed values fall back to the defaults', () => {
  const parsed = parseAllRequestsParams(params('type=Other&status=Done&from=2026-02-30&to=yesterday&sort=up&page=-2'))
  assert.deepEqual(parsed, DEFAULT_ALL_REQUESTS_FILTERS)
  assert.equal(parseAllRequestsParams(params('page=2.5')).page, 1)
  assert.equal(parseAllRequestsParams(params(`q=${'x'.repeat(150)}`)).search.length, 100)
  assert.equal(validDate('2028-02-29'), '2028-02-29')
  assert.equal(validDate('2027-02-29'), null)
  assert.deepEqual(ALL_REQUEST_TYPES, ['Raise Capacity', 'Incomplete Exam', 'Program Change', 'Course Equivalency', 'Course Substitution'])
})

test('Clear filters is offered only when something is filtered; impossible ranges are reported', () => {
  assert.equal(hasActiveFilters(DEFAULT_ALL_REQUESTS_FILTERS), false)
  assert.equal(hasActiveFilters({ ...DEFAULT_ALL_REQUESTS_FILTERS, page: 4 }), false)
  for (const patch of [{ search: 'x' }, { type: 'Raise Capacity' }, { status: 'Rejected' as const },
    { from: '2026-01-01' }, { to: '2026-01-01' }, { sort: 'oldest' as const }]) {
    assert.equal(hasActiveFilters({ ...DEFAULT_ALL_REQUESTS_FILTERS, ...patch }), true, JSON.stringify(patch))
  }
  assert.match(dateRangeError('2026-03-02', '2026-03-01') ?? '', /From date/)
  assert.equal(dateRangeError('2026-03-01', '2026-03-01'), null)
  assert.equal(dateRangeError(null, '2026-03-01'), null)
})

// -- Status filter = badge -------------------------------------------------------------

test('the status filter offers In Progress, Approved and Rejected; Completed is not offered', () => {
  assert.deepEqual([...FILTER_STATUSES], ['In Progress', 'Approved', 'Rejected'])
  // The page lists exactly these after "All statuses".
  assert.match(PAGE, /<option value="">All statuses<\/option>\s+\{FILTER_STATUSES\.map\(\(status\) => \(/)
  assert.doesNotMatch(PAGE, /DISPLAY_STATUSES/)
  // An old ?status=Completed link shows All statuses (nothing hidden).
  assert.equal(parseAllRequestsParams(params('status=Completed')).status, null)
  for (const status of FILTER_STATUSES) assert.equal(parseAllRequestsParams(params(`status=${status}`)).status, status)
})

test('every badge status still maps to a plan (stored values and decision logic unchanged)', () => {
  assert.deepEqual([...DISPLAY_STATUSES], ['In Progress', 'Approved', 'Completed', 'Rejected'])
  assert.deepEqual(statusPlan(null), { kind: 'any' })
  assert.deepEqual(statusPlan('In Progress'), { kind: 'stored', stored: 'In Progress' })
  assert.deepEqual(statusPlan('Rejected'), { kind: 'stored', stored: 'Rejected' })
  assert.deepEqual(statusPlan('Approved'), { kind: 'approved', stored: 'Completed' })
  assert.deepEqual(statusPlan('Completed'), { kind: 'unconfirmed', stored: 'Completed' })
  assert.deepEqual([...ALWAYS_APPROVED_TYPES], ['Raise Capacity', 'Program Change'])
  assert.deepEqual([...RECORDED_APPROVAL_TYPES].sort(), ['Course Equivalency', 'Course Substitution', 'Incomplete Exam'])
})

// What the database query keeps for a plan (the filters fetchAllRequests sends).
function kept(plan: StatusPlan, row: { id: string; type: string; status: string }, approved: Set<string>) {
  if (plan.kind === 'any') return true
  if (row.status !== plan.stored) return false
  if (plan.kind === 'approved') return ALWAYS_APPROVED_TYPES.includes(row.type) || approved.has(row.id)
  if (plan.kind === 'unconfirmed') return RECORDED_APPROVAL_TYPES.includes(row.type) && !approved.has(row.id)
  return true
}

test('every row is kept by exactly one status filter, and it is the label on its badge', () => {
  for (const type of ALL_REQUEST_TYPES) {
    for (const status of ['In Progress', 'Completed', 'Rejected']) {
      for (const recorded of [false, true]) {
        // A recorded approval exists only for Completed rows of recorded types (approvedRequestIds).
        if (recorded && !(status === 'Completed' && RECORDED_APPROVAL_TYPES.includes(type))) continue
        const row = { id: 'R1', type, status }
        const approved = new Set(recorded ? ['R1'] : [])
        const matching = DISPLAY_STATUSES.filter((s) => kept(statusPlan(s), row, approved))
        assert.deepEqual(matching, [statusLabel(status, type, recorded)], `${type} / ${status} / recorded=${recorded}`)
      }
    }
  }
})

test('recorded approvals: only a matching "<type> Approved" decision on a Completed request of that type counts', () => {
  const ids = approvedRequestIds([
    { Request_ID: 'IE1', Decision_Type: 'Incomplete Exam Approved', Request: { Request_Type: 'Incomplete Exam', Current_Status: 'Completed' } },
    { Request_ID: 'CE1', Decision_Type: 'Course Equivalency Approved', Request: [{ Request_Type: 'Course Equivalency', Current_Status: 'Completed' }] },
    // Wrong type for the request, not Completed, an always-approved type, no request: never counted.
    { Request_ID: 'CS1', Decision_Type: 'Incomplete Exam Approved', Request: { Request_Type: 'Course Substitution', Current_Status: 'Completed' } },
    { Request_ID: 'IE2', Decision_Type: 'Incomplete Exam Approved', Request: { Request_Type: 'Incomplete Exam', Current_Status: 'Rejected' } },
    { Request_ID: 'RC1', Decision_Type: 'Raise Capacity Approved', Request: { Request_Type: 'Raise Capacity', Current_Status: 'Completed' } },
    { Request_ID: 'X1', Decision_Type: 'Incomplete Exam Approved', Request: null },
  ])
  assert.deepEqual(ids, ['CE1', 'IE1'])
})

// -- Filter strings ------------------------------------------------------------------

test('search covers request ID and student ID only (not student name), with PostgREST-breaking characters removed', () => {
  assert.equal(searchTerm(' Ali,(x)  "y" '), 'Ali x y')
  assert.equal(idSearchGroup('u2419'), 'Request_ID.ilike."%u2419%",Student_ID.ilike."%u2419%"')
  assert.equal(idSearchGroup('INC2_000008'), 'Request_ID.ilike."%INC2_000008%",Student_ID.ilike."%INC2_000008%"')
  const ALL_SECTION = SERVICE.slice(SERVICE.indexOf('// All Requests (/admin/requests)'), SERVICE.indexOf('// Requests of one type'))
  assert.match(ALL_SECTION, /if \(term\) groups\.push\(idSearchGroup\(term\)\)/)
  // No student-name lookup, and no course / program text search (the Raise
  // Capacity course filter is an exact Course_ID match, not part of search).
  assert.doesNotMatch(ALL_SECTION, /Student_Name'|\.from\('Student'\)|studentIdsNamed|studentSearchGroup/)
  assert.doesNotMatch(ALL_SECTION, /Course_Name\.ilike|Program_Name|requestIdsByTarget/)
  // The search text still comes from (and goes back to) the URL's q parameter.
  assert.equal(parseAllRequestsParams(params('q=U24199999')).search, 'U24199999')
  assert.equal(toAllRequestsParams({ ...DEFAULT_ALL_REQUESTS_FILTERS, search: 'STUD_INCRQ' }).toString(), 'q=STUD_INCRQ')
  // The page's text says so; the Student Name column stays.
  assert.match(PAGE, /placeholder="Search request ID or student ID"/)
  assert.match(PAGE, />\s+Search by request ID or student ID\s+</)
  assert.match(PAGE, /<th scope="col">Student Name<\/th>/)
  assert.match(PAGE, /<td className="adm-table__name">\{row\.studentName \?\? '—'\}<\/td>/)
})

test('Approved = always-approved types or a recorded approval; groups combine with AND', () => {
  assert.equal(inList([]), null)
  assert.equal(approvedGroup([]), 'Request_Type.in.("Raise Capacity","Program Change")')
  assert.equal(approvedGroup(['IE1']), 'Request_Type.in.("Raise Capacity","Program Change"),Request_ID.in.("IE1")')
  assert.equal(combineOrGroups([]), null)
  assert.equal(combineOrGroups(['a.eq.1,b.eq.2']), 'a.eq.1,b.eq.2')
  assert.equal(combineOrGroups(['a.eq.1,b.eq.2', 'c.eq.3']), 'and(or(a.eq.1,b.eq.2),or(c.eq.3))')
})

// -- The query ------------------------------------------------------------------------

const ALL = SERVICE.slice(SERVICE.indexOf('// All Requests (/admin/requests)'), SERVICE.indexOf('// Requests of one type'))

test('All Requests: filtered, counted, sorted and paged in the database, 10 per page', () => {
  assert.equal(ALL_REQUESTS_PAGE_SIZE, 10)
  assert.match(ALL, /const select = \[REQUEST_WITH_STUDENT, \.\.\.embeds\]\.join\(', '\)/)
  assert.match(ALL, /supabase\.from\('Request'\)\.select\(select, \{ count: 'exact' \}\)/)
  assert.match(ALL, /if \(filters\.type\) query = query\.eq\('Request_Type', filters\.type\)/)
  assert.match(ALL, /if \(plan\.kind !== 'any'\) query = query\.eq\('Current_Status', plan\.stored\)/)
  assert.match(ALL, /query = query\.in\('Request_Type', \[\.\.\.RECORDED_APPROVAL_TYPES\]\)\s+if \(excluded\) query = query\.not\('Request_ID', 'in', excluded\)/)
  // Submission window: UAE boundaries converted to the stored UTC date and time.
  assert.match(ALL, /if \(filters\.from\) groups\.push\(submittedFromGroup\(submittedFromUtc\(filters\.from, filters\.fromTime\)\)\)/)
  assert.match(ALL, /if \(filters\.to\) groups\.push\(submittedBeforeGroup\(submittedToUtcExclusive\(filters\.to, filters\.toTime\)\)\)/)
  assert.doesNotMatch(ALL, /created_at/)
  assert.match(ALL, /if \(orFilter\) query = query\.or\(orFilter\)/)
  // Newest or oldest first, by date, time and Request ID together.
  assert.match(ALL, /const ascending = filters\.sort === 'oldest'/)
  assert.match(ALL, /\.order\('Request_Date', \{ ascending \}\)\s+\.order\('Submission_Time', \{ ascending \}\)\s+\.order\('Request_ID', \{ ascending \}\)/)
  // One page with an exact total; badges get their recorded approvals.
  assert.match(ALL, /await fetchPage\(build, filters\.page, ALL_REQUESTS_PAGE_SIZE\)/)
  assert.match(ALL, /rows: await withRecordedApprovals\(/)
  // Read only: no writes, no backend calls; the only RPC is the staff-only
  // read of saved priority levels.
  assert.doesNotMatch(ALL, /\.(insert|update|upsert|delete)\(|fetch\(|api\//)
  assert.deepEqual([...ALL.matchAll(/\.rpc\('([a-z_]+)'/g)].map((m) => m[1]), ['get_raise_capacity_priorities'])
})

test('the recorded approvals for the filter are read completely, only when needed, and a failure is an error', () => {
  assert.match(ALL, /\.from\('Decision'\)\s+\.select\('Request_ID, Decision_Type, Request\(Request_Type, Current_Status\)', \{ count: 'exact' \}\)\s+\.in\('Decision_Type', Object\.values\(APPROVAL_DECISION_TYPES\)\)\s+\.order\('Decision_ID'\)\s+\.range\(from, to\)/)
  assert.match(ALL, /needsApprovalIds\(plan\) \? fetchApprovedRequestIds\(\) : Promise\.resolve\(\[\] as string\[\]\)/)
  // Paged until the exact count is reached; an incomplete read is an error.
  assert.match(ALL, /while \(total === null \|\| rows\.length < total\)/)
  assert.match(ALL, /if \(batch\.length === 0 && rows\.length < total\) \{\s+throw new AllRequestsFilterError/)
})

// -- The page -------------------------------------------------------------------------

test('route: /admin/requests is admin-only, separate from the per-type lists', () => {
  assert.match(APP, /path="\/admin\/requests"\s+element=\{\s+<ProtectedRoute requiredRole="admin">\s+<AdminAllRequests \/>/)
  assert.match(APP, /path="\/admin\/requests\/:typeId"\s+element=\{\s+<ProtectedRoute requiredRole="admin">\s+<AdminTypeRequests \/>/)
})

test('page: filters live in the URL; changes go back to page 1; Clear filters empties the URL', () => {
  assert.match(PAGE, /const \[params, setParams\] = useSearchParams\(\)/)
  assert.match(PAGE, /const filters = parseAllRequestsParams\(params\)/)
  assert.match(PAGE, /toAllRequestsParams\(applyFilterPatch\(parseAllRequestsParams\(prev\), patch\)\)/)
  assert.match(PAGE, /onPageChange=\{\(page\) => apply\(\{ page \}\)\}/)
  assert.match(PAGE, /setParams\(new URLSearchParams\(\), \{ replace: true \}\)/)
  // Clear all sits with the active filter chips (no separate toolbar button).
  assert.match(PAGE, /onClick=\{clearFilters\}>\s+Clear all\s+</)
  assert.doesNotMatch(PAGE, /Clear filters/)
  for (const id of ['aar-q', 'aar-type', 'aar-status', 'aar-from', 'aar-to', 'aar-sort', 'aar-term', 'aar-from-time', 'aar-to-time']) {
    assert.match(PAGE, new RegExp(`(htmlFor|id)="${id}"`), id)
  }
  assert.match(PAGE, /<option value="newest">Newest first<\/option>\s+<option value="oldest">Oldest first<\/option>/)
  // An impossible date / time window is reported and not queried.
  assert.match(PAGE, /const rangeError = dateRangeError\(filters\.from, filters\.to, filters\.fromTime, filters\.toTime\)/)
  assert.match(PAGE, /useAllRequests\(filters, rangeError === null\)/)
  // The URL is kept in step with the controls (invalid or dropped values removed).
  assert.match(PAGE, /const canonical = canonicalAllRequestsParams\(params\)\s+if \(canonical\.toString\(\) !== params\.toString\(\)\) setParams\(canonical, \{ replace: true \}\)/)
})

test('page: the columns, read-only priorities and review links that return to this list', () => {
  const headers = [...PAGE.matchAll(/<th scope="col"[^>]*>\s*([^<]+?)\s*</g)].map((m) => m[1])
  assert.deepEqual(headers, ['Request ID', 'Student Name', 'Student ID', 'Request Type', 'Submission Date', 'Status', 'Priority', 'Action'])
  // Saved priorities only: All Requests never starts a priority check.
  assert.match(PAGE, /useRaiseCapacityPriorities\(\s+list\.status === 'ready' \? list\.rows\.filter\(\(row\) => row\.type === 'Raise Capacity'\)\.map\(\(row\) => row\.id\) : \[\],\s+\{ autoStart: false \},\s+\)/)
  assert.match(PAGE, /origin="all-requests"\s+returnSearch=\{location\.search\}\s+label=\{row\.status === 'In Progress' \? 'Review' : 'View'\}/)
  assert.match(PAGE, /<AllRequestsBreadcrumb \/>/)
})

test('the priority hook starts checks only when allowed (default unchanged for the other lists)', () => {
  const HOOK = read('../src/hooks/useRaiseCapacityPriorities.ts')
  assert.match(HOOK, /\{ autoStart = true \}: \{ autoStart\?: boolean \} = \{\}/)
  assert.match(HOOK, /const eligible = autoStart \? states\.filter\(\(s\) => s\.auto_eligible\)\.map\(\(s\) => s\.request_id\) : \[\]/)
  assert.doesNotMatch(read('../src/pages/AdminTypeRequests.tsx'), /autoStart/)
  assert.doesNotMatch(PENDING, /autoStart/)
})

// -- Review navigation -------------------------------------------------------------------

test('the way back from a review restores the list (only a plain query string on /admin/requests)', () => {
  assert.equal(allRequestsReturnPath({ from: 'all-requests', search: '?status=Approved&page=2' }), '/admin/requests?status=Approved&page=2')
  assert.equal(allRequestsReturnPath({ from: 'all-requests', search: '' }), '/admin/requests')
  for (const bad of ['//evil.example', '?a=1#x', 'status=1', '?a=/b', 42]) {
    assert.equal(allRequestsReturnPath({ from: 'all-requests', search: bad }), '/admin/requests', String(bad))
  }
  assert.equal(allRequestsReturnPath({ from: 'dashboard' }), null)
  assert.equal(allRequestsReturnPath(null), null)

  const ACTION = read('../src/components/admin/ReviewAction.tsx')
  assert.match(ACTION, /const state = origin === 'all-requests' \? \{ from: origin, search: returnSearch \} : \{ from: origin \}/)
})

test('all five review pages: breadcrumb and back link lead to All Requests when opened from it', () => {
  const CRUMB = read('../src/components/admin/ReviewBreadcrumb.tsx')
  assert.match(CRUMB, /const allRequests = allRequestsReturnPath\(location\.state\)/)
  assert.match(CRUMB, /\) : allRequests \? \(\s+<Link to=\{allRequests\} className="service-breadcrumb__link">\s+All Requests\s+<\/Link>/)
  for (const [page, typeId] of [['AdminRaiseCapacityReview', 'raise-capacity'], ['AdminProgramChangeReview', 'program-change'],
    ['AdminIncompleteExamReview', 'incomplete-exam'], ['AdminCourseSubstitutionReview', 'course-substitution'],
    ['AdminCourseEquivalencyReview', 'course-equivalency']]) {
    const source = read(`../src/pages/${page}.tsx`)
    assert.match(source, new RegExp(`<ReviewBreadcrumb typeId="${typeId}" />`), page)
    assert.match(source, /const allRequests = allRequestsReturnPath\(location\.state\)\s+const back = allRequests\s+\? \{ to: allRequests, label: 'All Requests' \}\s+: origin === 'dashboard'/, page)
  }
})

// -- Dashboard ------------------------------------------------------------------------

test('dashboard: exactly the 10 latest In Progress requests, no type filter, no pages, View All Requests', () => {
  const PENDING_SECTION = SERVICE.slice(SERVICE.indexOf('export const PENDING_LIMIT'), SERVICE.indexOf('// All Requests (/admin/requests)'))
  assert.match(PENDING_SECTION, /export const PENDING_LIMIT = 10/)
  assert.match(PENDING_SECTION, /export async function fetchPendingRequests\(\): Promise<PendingRequests>/)
  assert.match(PENDING_SECTION, /\.eq\('Current_Status', IN_PROGRESS\)\s+\.order\('Request_Date', \{ ascending: false \}\)\s+\.order\('Submission_Time', \{ ascending: false \}\)\s+\.order\('Request_ID', \{ ascending: false \}\)\s+\.range\(0, PENDING_LIMIT - 1\)/)
  assert.doesNotMatch(PENDING_SECTION, /Request_Type/)

  assert.doesNotMatch(PENDING, /<select|Pager|onTypeChange|onPageChange/)
  // The student dashboard's text link (same class, text and arrow as Recent Requests).
  assert.match(PENDING, /<Link to=\{ALL_REQUESTS_PATH\} className="student-recent__all">\s+View all requests\s+<span aria-hidden="true">→<\/span>\s+<\/Link>/)
  assert.match(read('../src/components/student/RecentRequests.tsx'),
    /<Link to=\{MY_REQUESTS_PATH\} className="student-recent__all">\s+View all requests\s+<span aria-hidden="true">→<\/span>/)
  assert.match(DASHBOARD, /import '\.\.\/components\/requests\/Requests\.css'/)
  assert.doesNotMatch(read('../src/pages/AdminDashboard.css'), /adm-pending__all/)
  assert.match(PENDING, /<ReviewAction requestId=\{row\.id\} requestType=\{row\.type\} origin="dashboard" \/>/)
  assert.match(PENDING, /<PriorityCell requestId=\{row\.id\} requestType=\{row\.type\} priorities=\{priorities\} \/>/)

  // The other dashboard sections stay.
  assert.match(DASHBOARD, /<AdminSearch \/>/)
  assert.match(DASHBOARD, /<AdminRequestTypes/)
  assert.match(DASHBOARD, /<PendingRequests \/>/)
  assert.doesNotMatch(DASHBOARD, /pendingType|pendingPage|useState/)
})

test('the per-type lists keep their own search, status tabs, pages and back navigation', () => {
  const TYPE = read('../src/pages/AdminTypeRequests.tsx')
  assert.match(TYPE, /const list = useTypeRequests\(type, statusTab, search, page, extra\)/)
  assert.match(TYPE, /\.\.\.REQUEST_STATUSES\.map\(\(status\) => \(\{/)
  assert.match(TYPE, /<ReviewAction requestId=\{row\.id\} requestType=\{type\} origin="type-list" \/>/)
  assert.match(SERVICE, /export async function fetchTypeRequests\(/)
  assert.match(SERVICE, /const \[filter, priorityRows\] = await Promise\.all\(\[\s+searchFilter\(type, search\),/)
  // The dashboard's type cards still open them.
  assert.match(read('../src/components/admin/AdminRequestTypes.tsx'), /adminTypePath\(/)
})

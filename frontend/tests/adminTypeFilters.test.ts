// The five per-type admin request lists (/admin/requests/:typeId): the
// additional filters of Raise Capacity and Incomplete Exam (none for Program
// Change, Course Substitution and Course Equivalency), how they combine with
// the status tabs and search in the database query, the Filters panel, and the
// sliding 10-per-page pager on all five. No browser, database or AI.
// Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  EMPTY_TYPE_FILTERS,
  patchTypeFilters,
  typeDetailConditions,
  typeFilterChips,
  typeFilterCount,
  typeFilterFields,
  typeHasFilters,
  type TypeFilters,
} from '../src/utils/adminTypeFilters.ts'
import { pageWindow, pageWindowStart } from '../src/utils/pageWindow.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const SERVICE = read('../src/services/adminRequests.ts')
const PAGE = read('../src/pages/AdminTypeRequests.tsx')
const PANEL = read('../src/components/admin/TypeFilterPanel.tsx')
const UTIL = read('../src/utils/adminTypeFilters.ts')
const TYPE_FN = SERVICE.slice(SERVICE.indexOf('export async function fetchTypeRequests('), SERVICE.indexOf('// Options of the per-type additional filters'))
const OPTIONS = SERVICE.slice(SERVICE.indexOf('// Options of the per-type additional filters'), SERVICE.indexOf('// Search by exact student ID'))
const f = (patch: Partial<TypeFilters>): TypeFilters => ({ ...EMPTY_TYPE_FILTERS, ...patch })
const NO_FILTER_TYPES = ['Program Change', 'Course Substitution', 'Course Equivalency']

// -- Which services have filters ------------------------------------------------------------

test('Raise Capacity and Incomplete Exam have additional filters; the other three have none', () => {
  assert.deepEqual(typeFilterFields('Raise Capacity'), { priority: true, course: true, section: true, term: true })
  assert.deepEqual(typeFilterFields('Incomplete Exam'), { priority: false, course: true, section: false, term: true })
  assert.equal(typeHasFilters('Raise Capacity'), true)
  assert.equal(typeHasFilters('Incomplete Exam'), true)
  for (const type of NO_FILTER_TYPES) {
    assert.equal(typeHasFilters(type), false, type)
    // Any stray value gives no condition, no count and no chip.
    const stray = f({ priority: 'HIGH', course: 'A101', section: '61', term: 202601 })
    assert.deepEqual(typeDetailConditions(type, stray), [], type)
    assert.equal(typeFilterCount(type, stray), 0, type)
    assert.deepEqual(typeFilterChips(type, stray), [], type)
  }
  // The program / course-pair filters are gone.
  assert.doesNotMatch(UTIL + PANEL, /programKey|TYPE_PAIR_FIELDS|Original_Course_ID|Old_Course_ID|Current_Program|fields\.pair/)
})

test('Raise Capacity: course, section and stored term on Raise_Capacity (priority is a request-ID set)', () => {
  assert.deepEqual(typeDetailConditions('Raise Capacity', f({ course: '1501116', section: '61', term: 202601, priority: 'HIGH' })), [
    { column: 'Course_ID', value: '1501116' },
    { column: 'Section_ID', value: '61' },
    { column: 'Term', value: 202601 },
  ])
  // A section without a course is ignored.
  assert.deepEqual(typeDetailConditions('Raise Capacity', f({ section: '61' })), [])
})

test('Incomplete Exam: course and stored term; Raise Capacity-only values are ignored', () => {
  assert.deepEqual(typeDetailConditions('Incomplete Exam', f({ course: '1501116', term: 202602, section: '61', priority: 'LOW' })), [
    { column: 'Course_ID', value: '1501116' },
    { column: 'Term', value: 202602 },
  ])
})

// -- Counts, clearing, chips ------------------------------------------------------------------

test('count, chips and clearing (Course also clears Section)', () => {
  const rc = f({ priority: 'MANUAL_REVIEW', course: '1501116', section: '61', term: 202601 })
  assert.equal(typeFilterCount('Raise Capacity', rc), 4)
  assert.equal(typeFilterCount('Incomplete Exam', rc), 2) // only course and term apply
  assert.deepEqual(typeFilterChips('Raise Capacity', rc).map((c) => c.label),
    ['Manual Review Priority', 'Course 1501116', 'Section 61', 'Fall 2026'])
  assert.deepEqual(typeFilterChips('Incomplete Exam', rc).map((c) => c.label), ['Course 1501116', 'Fall 2026'])
  assert.deepEqual(patchTypeFilters(rc, { course: '1501215' }), { ...rc, course: '1501215', section: null })
  assert.deepEqual(patchTypeFilters(rc, { course: null }), { ...rc, course: null, section: null })
  assert.deepEqual(patchTypeFilters(rc, { term: null }), { ...rc, term: null })
  assert.equal(typeFilterCount('Raise Capacity', EMPTY_TYPE_FILTERS), 0)
})

// -- The database query -----------------------------------------------------------------------

test('filters are applied in the database, with the status and search, before paging', () => {
  // The type's own detail table through a filter-only inner embed.
  assert.match(TYPE_FN, /const filterEmbed = details && conditions\.length \? `, flt:\$\{details\.table\}!inner\(Request_ID\)` : ''/)
  assert.match(TYPE_FN, /if \(filterEmbed\) for \(const c of conditions\) query = query\.eq\(`flt\.\$\{c\.column\}`, c\.value\)/)
  // Status and search are unchanged and combine with them (all AND).
  assert.match(TYPE_FN, /if \(status\) query = query\.eq\('Current_Status', status\)\s+if \(filter\) query = query\.or\(filter\)/)
  assert.match(TYPE_FN, /\.eq\('Request_Type', type\)/)
  // Priority through the staff-only function; nothing matches -> empty page.
  assert.match(TYPE_FN, /const usePriority = type === RAISE_CAPACITY && filters\.priority !== null/)
  assert.match(TYPE_FN, /usePriority \? fetchPriorityLevels\(\) : Promise\.resolve\(null\)/)
  assert.match(TYPE_FN, /if \(priority\?\.mode === 'in' && priority\.ids\.length === 0\) return \{ rows: \[\], total: 0, page: 1 \}/)
  assert.match(TYPE_FN, /if \(priority\?\.mode === 'in'\) query = query\.in\('Request_ID', priority\.ids\)/)
  assert.match(TYPE_FN, /throw new AllRequestsFilterError\(/)
  // Exact count, 10 per page.
  assert.match(TYPE_FN, /\{\s+count: 'exact',\s+\}/)
  assert.match(TYPE_FN, /await fetchPage\(build, page, TYPE_PAGE_SIZE\)/)
  assert.match(SERVICE, /export const TYPE_PAGE_SIZE = 10/)
})

test('options: read completely for Raise Capacity and Incomplete Exam only', () => {
  assert.match(OPTIONS, /if \(!details \|\| \(type !== RAISE_CAPACITY && type !== INCOMPLETE_EXAM\)\) return empty/)
  assert.match(OPTIONS, /readEveryRow<T>\(\s+\(from, to\) => supabase\.from\(details\.table\)\.select\(columns, \{ count: 'exact' \}\)\.order\('Request_ID'\)\.range\(from, to\)/)
  assert.ok(OPTIONS.includes("'Course_ID, Section_ID, Term'"))
  assert.ok(OPTIONS.includes("'Course_ID, Term'"))
  assert.doesNotMatch(OPTIONS, /Program_|Original_Course|Proposed_Course|Old_Course|New_Course|programOptions/)
  // Course names only for those IDs; restricted priority columns never read directly.
  assert.match(OPTIONS, /supabase\.from\('Course'\)\.select\('Course_ID, Course_Name'\)\.in\('Course_ID', unique\.slice\(i, i \+ 100\)\)/)
  // (Priority_Level is selected only from the staff-only function's result.)
  assert.doesNotMatch(SERVICE, /\.from\([^)]*\)\s*\.select\('[^']*Priority_/)
  assert.doesNotMatch(SERVICE, /raise_capacity_priority_run/)
})

// -- The page ---------------------------------------------------------------------------------

test('Filters button, panel and chips only where the service has filters', () => {
  assert.match(PAGE, /const hasFilters = typeHasFilters\(type\)/)
  assert.match(PAGE, /\{hasFilters && \(\s+<button\s+type="button"\s+className="tfp-toggle"\s+aria-expanded=\{panelOpen\}\s+aria-controls=\{panelId\}/)
  assert.match(PAGE, /\{hasFilters && panelOpen && \(\s+<TypeFilterPanel/)
  assert.match(PAGE, /\{hasFilters && extraChips\.length > 0 && \(/)
  assert.match(PAGE, /const \[panelOpen, setPanelOpen\] = useState\(false\)/)
  assert.match(PAGE, /Filters\s+\{extraCount > 0 && \(\s+<span className="tfp-count">/)
  // Filters stay applied while the panel is closed; chips remove one filter each.
  assert.match(PAGE, /const list = useTypeRequests\(type, statusTab, search, page, extra\)/)
  assert.match(PAGE, /aria-label=\{`Remove filter: \$\{chip\.label\}`\}\s+onClick=\{\(\) => changeExtra\(chip\.remove\)\}/)
  // Changes go back to page 1; Clear filters clears only the additional filters.
  assert.match(PAGE, /setExtra\(\(current\) => patchTypeFilters\(current, patch\)\)\s+setPage\(1\)/)
  assert.match(PAGE, /const clearExtra = \(\) => \{\s+setExtra\(EMPTY_TYPE_FILTERS\)\s+setPage\(1\)/)
  assert.doesNotMatch(PAGE.slice(PAGE.indexOf('const clearExtra'), PAGE.indexOf('const counts')), /setStatusTab|setSearch|setQuery/)
  assert.match(PANEL, /onClick=\{onClear\} disabled=\{count === 0\}>\s+Clear filters/)
  // Empty state and explicit errors.
  assert.match(PAGE, /Try another status, search term or filter\./)
  assert.match(PAGE, /\{list\.filterError \?\? 'Check your connection and try again\.'\}/)
})

test('the panel: priority, course, section (disabled until a course) and term', () => {
  assert.match(PANEL, /\{fields\.priority && \(/)
  assert.match(PANEL, /\{fields\.course && \(\s+<div className="tfp-combo">\s+<CourseCombobox/)
  assert.match(PANEL, /courses=\{options\?\.courses \?\? \[\]\}/)
  assert.match(PANEL, /id=\{`\$\{id\}-section`\}\s+value=\{filters\.section \?\? ''\}\s+disabled=\{!filters\.course\}/)
  assert.match(PANEL, /\{fields\.term && \(/)
  assert.match(PANEL, /required=\{false\}/)
  assert.match(PANEL, /Filter options couldn’t load\./)
})

test('status tabs, counts, search and Review / View are unchanged on all five', () => {
  assert.match(PAGE, /\.\.\.REQUEST_STATUSES\.map\(\(status\) => \(\{\s+label: statusLabel\(status, type\),/)
  assert.match(PAGE, /const counts = useTypeStatusCounts\(type\)/)
  assert.match(PAGE, /<ReviewAction requestId=\{row\.id\} requestType=\{type\} origin="type-list" \/>/)
  assert.match(PAGE, /placeholder="Search ID, student or course"/)
})

// -- Pagination (all five) -------------------------------------------------------------------

test('10 per page with the sliding three-number pager', () => {
  assert.match(PAGE, /import WindowedPager from '\.\.\/components\/admin\/WindowedPager'/)
  assert.match(PAGE, /<WindowedPager\s+label=\{`\$\{type\} requests pages`\}/)
  assert.doesNotMatch(PAGE, /<Pager\b/)
  assert.deepEqual(pageWindow(pageWindowStart(1, 1, 1), 1), [1])
  assert.deepEqual(pageWindow(pageWindowStart(1, 2, 2), 2), [1, 2])
  let start = 1
  const seen = [1, 2, 3, 4, 5].map((page) => (start = pageWindowStart(start, page, 8), pageWindow(start, 8)))
  assert.deepEqual(seen, [[1, 2, 3], [1, 2, 3], [1, 2, 3], [2, 3, 4], [3, 4, 5]])
})

// Admin All Requests: submission time (UAE -> UTC), academic term (stored and
// derived), Raise Capacity priority / course / section, URL state and layout.
// Database semantics are checked by applying the same boundaries and plans to
// synthetic rows; the query wiring is checked in the service source.
// No browser, database or AI. Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  DEFAULT_ALL_REQUESTS_FILTERS,
  DERIVED_TERM_TYPES,
  MAX_FILTER_IDS,
  PRIORITY_FILTERS,
  PRIORITY_FILTER_LABELS,
  applyFilterPatch,
  canonicalAllRequestsParams,
  combineOrGroups,
  dateRangeError,
  hasActiveFilters,
  moreFiltersCount,
  parseAllRequestsParams,
  priorityIdFilter,
  requestedCourseIds,
  requestedSections,
  submittedBeforeGroup,
  submittedFromGroup,
  submittedFromUtc,
  submittedToUtcExclusive,
  termFromSubmissionDate,
  termLabel,
  termOptions,
  termPlan,
  termSubmissionDates,
  toAllRequestsParams,
  validTerm,
  validTime,
  type AllRequestsFilters,
  type UtcBoundary,
} from '../src/utils/adminAllRequests.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const SERVICE = read('../src/services/adminRequests.ts')
const PAGE = read('../src/pages/AdminAllRequests.tsx')
const CSS = read('../src/pages/AdminAllRequests.css')
const COMBO = read('../src/components/courseEquivalency/CourseCombobox.tsx')
const ALL = SERVICE.slice(SERVICE.indexOf('// All Requests (/admin/requests)'), SERVICE.indexOf('// Requests of one type'))
const params = (query: string) => new URLSearchParams(query)
const filters = (patch: Partial<AllRequestsFilters>): AllRequestsFilters => ({ ...DEFAULT_ALL_REQUESTS_FILTERS, ...patch })

// What the database keeps for a stored UTC (Request_Date, Submission_Time),
// exactly as the OR groups express it.
const atOrAfter = (row: { date: string; time: string }, b: UtcBoundary) => row.date > b.date || (row.date === b.date && row.time >= b.time)
const before = (row: { date: string; time: string }, b: UtcBoundary) => row.date < b.date || (row.date === b.date && row.time < b.time)

// -- 1. UAE -> UTC, midnight rollover ----------------------------------------------

test('UAE boundaries become UTC (UTC+4, the date rolls back before 04:00)', () => {
  assert.deepEqual(submittedFromUtc('2026-11-21', '03:30'), { date: '2026-11-20', time: '23:30:00' })
  assert.deepEqual(submittedFromUtc('2026-11-21', '00:00'), { date: '2026-11-20', time: '20:00:00' })
  assert.deepEqual(submittedFromUtc('2026-11-21', '04:00'), { date: '2026-11-21', time: '00:00:00' })
  assert.deepEqual(submittedFromUtc('2026-11-21', '14:30'), { date: '2026-11-21', time: '10:30:00' })
  // Year boundary.
  assert.deepEqual(submittedFromUtc('2027-01-01', '01:15'), { date: '2026-12-31', time: '21:15:00' })
  // To is exclusive one minute after the chosen minute.
  assert.deepEqual(submittedToUtcExclusive('2026-11-21', '14:30'), { date: '2026-11-21', time: '10:31:00' })
  assert.deepEqual(submittedToUtcExclusive('2026-11-21', '03:59'), { date: '2026-11-21', time: '00:00:00' })
  assert.deepEqual(submittedToUtcExclusive('2026-12-31', '23:59'), { date: '2026-12-31', time: '20:00:00' })
})

test('the OR groups compare date and time together on the stored UTC columns', () => {
  const b = { date: '2026-11-20', time: '20:00:00' }
  assert.equal(submittedFromGroup(b), 'Request_Date.gt.2026-11-20,and(Request_Date.eq.2026-11-20,Submission_Time.gte."20:00:00")')
  assert.equal(submittedBeforeGroup(b), 'Request_Date.lt.2026-11-20,and(Request_Date.eq.2026-11-20,Submission_Time.lt."20:00:00")')
})

// -- 2. Inclusive minute boundaries --------------------------------------------------

test('From is inclusive; To includes the whole selected minute', () => {
  const from = submittedFromUtc('2026-11-21', '14:30') // 10:30:00 UTC
  assert.equal(atOrAfter({ date: '2026-11-21', time: '10:30:00' }, from), true)
  assert.equal(atOrAfter({ date: '2026-11-21', time: '10:29:59.999' }, from), false)
  const to = submittedToUtcExclusive('2026-11-21', '14:30') // before 10:31:00 UTC
  assert.equal(before({ date: '2026-11-21', time: '10:30:59.999999' }, to), true)
  assert.equal(before({ date: '2026-11-21', time: '10:31:00' }, to), false)
})

// -- 3. Date-only = the whole UAE calendar day ---------------------------------------

test('a date alone means the whole UAE day (20:00 UTC the day before to 20:00 UTC)', () => {
  const from = submittedFromUtc('2026-11-21', null)
  const to = submittedToUtcExclusive('2026-11-21', null)
  const inDay = (row: { date: string; time: string }) => atOrAfter(row, from) && before(row, to)
  assert.equal(inDay({ date: '2026-11-20', time: '19:59:59' }), false) // 23:59:59 UAE on the 20th
  assert.equal(inDay({ date: '2026-11-20', time: '20:00:00' }), true) // 00:00 UAE on the 21st
  assert.equal(inDay({ date: '2026-11-21', time: '19:59:59.9' }), true) // 23:59:59 UAE
  assert.equal(inDay({ date: '2026-11-21', time: '20:00:00' }), false) // 00:00 UAE on the 22nd
  // Never the request's created_at.
  assert.doesNotMatch(ALL, /created_at/)
})

test('an impossible window is reported (compared in UAE time, minutes included)', () => {
  assert.match(dateRangeError('2026-11-21', '2026-11-21', '15:00', '14:59') ?? '', /must be on or before/)
  assert.equal(dateRangeError('2026-11-21', '2026-11-21', '14:59', '14:59'), null)
  assert.equal(dateRangeError('2026-11-21', '2026-11-21', '23:00', null), null)
  assert.match(dateRangeError('2026-11-22', '2026-11-21') ?? '', /must be on or before/)
})

// -- 4 / 5 / 6. Academic term --------------------------------------------------------

test('term sources per type: stored for Raise Capacity and Incomplete Exam, submission semester for the others', () => {
  assert.deepEqual(termPlan(202601, 'Raise Capacity'), { kind: 'stored', table: 'Raise_Capacity' })
  assert.deepEqual(termPlan(202601, 'Incomplete Exam'), { kind: 'stored', table: 'Incomplete_Exam' })
  for (const type of ['Program Change', 'Course Equivalency', 'Course Substitution']) {
    assert.deepEqual(termPlan(202601, type), { kind: 'derived', start: '2026-08-01', end: '2026-12-31' })
  }
  assert.deepEqual([...DERIVED_TERM_TYPES], ['Program Change', 'Course Equivalency', 'Course Substitution'])
  // Course_Equivalency.Old_Course_Term is not the request's term.
  assert.doesNotMatch(SERVICE, /Old_Course_Term/)
})

test('submission semesters: Aug-Dec Fall, Jan-May Spring, Jun-Jul Summer (previous year code)', () => {
  assert.equal(termFromSubmissionDate('2026-08-01'), 202601)
  assert.equal(termFromSubmissionDate('2026-12-31'), 202601)
  assert.equal(termFromSubmissionDate('2027-01-01'), 202602)
  assert.equal(termFromSubmissionDate('2027-05-31'), 202602)
  assert.equal(termFromSubmissionDate('2027-06-01'), 202603)
  assert.equal(termFromSubmissionDate('2027-07-31'), 202603)
  assert.deepEqual(termSubmissionDates(202602), { start: '2027-01-01', end: '2027-05-31' })
  assert.deepEqual(termSubmissionDates(202603), { start: '2027-06-01', end: '2027-07-31' })
  // Every derived term range maps back to its own code.
  for (const term of [202501, 202502, 202503, 202601]) {
    const { start, end } = termSubmissionDates(term)
    assert.equal(termFromSubmissionDate(start), term)
    assert.equal(termFromSubmissionDate(end), term)
  }
})

test('readable labels (knownTermName), including Summer; options newest first', () => {
  assert.equal(termLabel(202601), 'Fall 2026')
  assert.equal(termLabel(202602), 'Spring 2027')
  assert.equal(termLabel(202603), 'Summer 2027')
  assert.deepEqual(termOptions([202601, 202603, 202601, 202502]), [
    { value: 202603, label: 'Summer 2027' },
    { value: 202601, label: 'Fall 2026' },
    { value: 202502, label: 'Spring 2026' },
  ])
  assert.equal(validTerm('202603'), 202603)
  assert.equal(validTerm('202604'), null)
  assert.equal(validTerm('2026'), null)
})

// What the mixed (All types) term filter keeps, as the plan expresses it.
function keptByTerm(term: number, row: { type: string; date: string; rcTerm?: number; ieTerm?: number }) {
  const plan = termPlan(term, null)
  assert.equal(plan.kind, 'mixed')
  const { start, end } = termSubmissionDates(term)
  return row.rcTerm === term || row.ieTerm === term || (DERIVED_TERM_TYPES.includes(row.type) && row.date >= start && row.date <= end)
}

test('All types: stored and derived terms combined in one database filter', () => {
  const plan = termPlan(202601, null)
  assert.deepEqual(plan, {
    kind: 'mixed',
    group: 'rcTerm.not.is.null,ieTerm.not.is.null,and(Request_Type.in.("Program Change","Course Equivalency","Course Substitution"),Request_Date.gte.2026-08-01,Request_Date.lte.2026-12-31)',
  })
  // A Raise Capacity request for Fall 2026 submitted in February still counts as Fall 2026.
  assert.equal(keptByTerm(202601, { type: 'Raise Capacity', date: '2027-02-10', rcTerm: 202601 }), true)
  assert.equal(keptByTerm(202601, { type: 'Raise Capacity', date: '2026-09-10', rcTerm: 202602 }), false)
  assert.equal(keptByTerm(202601, { type: 'Incomplete Exam', date: '2026-09-10', ieTerm: 202401 }), false)
  assert.equal(keptByTerm(202601, { type: 'Program Change', date: '2026-09-10' }), true)
  assert.equal(keptByTerm(202601, { type: 'Course Substitution', date: '2027-02-01' }), false)
  assert.equal(keptByTerm(202603, { type: 'Course Equivalency', date: '2027-07-01' }), true)
  // The embeds and their Term filters in the query.
  assert.match(ALL, /`\$\{RC_TERM_ALIAS\}:Raise_Capacity\(\),\$\{IE_TERM_ALIAS\}:Incomplete_Exam\(\)`/)
  assert.match(ALL, /query = query\.eq\(`\$\{RC_TERM_ALIAS\}\.Term`, filters\.term\)\.eq\(`\$\{IE_TERM_ALIAS\}\.Term`, filters\.term\)/)
  assert.match(ALL, /if \(termFilter\?\.kind === 'mixed'\) groups\.push\(termFilter\.group\)/)
})

test('one type: the stored term through an inner join, or the submission dates', () => {
  assert.match(ALL, /if \(termFilter\?\.kind === 'stored'\) query = query\.eq\(`\$\{isRc \? 'rc' : 'ie'\}\.Term`, filters\.term\)/)
  assert.match(ALL, /rcInner \? 'rc:Raise_Capacity!inner\(Course_ID\)' : null/)
  assert.match(ALL, /ieInner \? 'ie:Incomplete_Exam!inner\(Request_ID\)' : null/)
  assert.match(ALL, /query = query\.gte\('Request_Date', termFilter\.start\)\.lte\('Request_Date', termFilter\.end\)/)
  // No term filter: no embed, nothing excluded for a missing or unknown term.
  assert.match(ALL, /const termFilter = filters\.term !== null \? termPlan\(filters\.term, filters\.type\) : null/)
})

// -- 7. Priority ---------------------------------------------------------------------

test('priority: saved levels match exactly; Not Assessed = no saved level (failed or unfinished included)', () => {
  assert.deepEqual([...PRIORITY_FILTERS], ['HIGH', 'MEDIUM', 'LOW', 'MANUAL_REVIEW', 'NOT_ASSESSED'])
  assert.deepEqual(Object.values(PRIORITY_FILTER_LABELS), ['High', 'Medium', 'Low', 'Manual Review', 'Not Assessed'])
  const rows = [
    { Request_ID: 'R3', Priority_Level: 'HIGH' },
    { Request_ID: 'R1', Priority_Level: 'high' },
    { Request_ID: 'R2', Priority_Level: 'MANUAL_REVIEW' },
    { Request_ID: 'R4', Priority_Level: null },
    { Request_ID: 'R5', Priority_Level: '' },
  ]
  assert.deepEqual(priorityIdFilter('HIGH', rows), { mode: 'in', ids: ['R1', 'R3'] })
  assert.deepEqual(priorityIdFilter('MANUAL_REVIEW', rows), { mode: 'in', ids: ['R2'] })
  assert.deepEqual(priorityIdFilter('LOW', rows), { mode: 'in', ids: [] })
  // Not Assessed excludes every assessed request (requests without a row at all are therefore included too).
  assert.deepEqual(priorityIdFilter('NOT_ASSESSED', rows), { mode: 'not-in', ids: ['R1', 'R2', 'R3'] })
})

test('priority: read through the staff-only function, applied before paging, errors explicit', () => {
  assert.match(ALL, /\.rpc\('get_raise_capacity_priorities', \{ p_request_ids: null \}, \{ count: 'exact' \}\)\s+\.select\('Request_ID, Priority_Level'\)\s+\.order\('Request_ID'\)\s+\.range\(from, to\)/)
  assert.doesNotMatch(SERVICE, /\.from\('Raise_Capacity'\)\.select\([^)]*Priority/)
  assert.doesNotMatch(SERVICE, /raise_capacity_priority_run/)
  assert.match(ALL, /isRc && filters\.priority \? fetchPriorityLevels\(\) : Promise\.resolve\(null\)/)
  // Nothing matches: an empty page, not an unfiltered list.
  assert.match(ALL, /if \(priority\?\.mode === 'in' && priority\.ids\.length === 0\) return \{ rows: \[\], total: 0, page: 1 \}/)
  assert.match(ALL, /if \(priority\?\.mode === 'in'\) query = query\.in\('Request_ID', priority\.ids\)/)
  assert.match(ALL, /if \(priority\?\.mode === 'not-in' && priority\.ids\.length\) query = query\.not\('Request_ID', 'in', inList\(priority\.ids\)\)/)
  // Only for Raise Capacity (the type filter is always applied with it).
  assert.match(ALL, /const isRc = filters\.type === RAISE_CAPACITY/)
  // Too many IDs: refused with a message, never truncated.
  assert.equal(MAX_FILTER_IDS, 400)
  assert.match(ALL, /if \(priority && priority\.ids\.length > MAX_FILTER_IDS\) \{\s+throw new AllRequestsFilterError/)
  assert.match(ALL, /'Raise Capacity priorities could not be loaded, so the Priority filter was not applied\. Try again\.'/)
})

// -- 8. Course and section -----------------------------------------------------------

test('course and section options come from the Raise Capacity requests themselves', () => {
  const rows = [
    { Course_ID: '1501215', Section_ID: '61', Term: 202601 },
    { Course_ID: '1501116', Section_ID: '61', Term: 202601 },
    { Course_ID: '1501116', Section_ID: '62', Term: 202601 },
    { Course_ID: '1501116', Section_ID: '61', Term: 202602 },
    { Course_ID: '1501215', Section_ID: '61', Term: 202601 },
  ]
  assert.deepEqual(requestedCourseIds(rows), ['1501116', '1501215'])
  assert.deepEqual(requestedSections(rows, '1501116'), [
    { value: '61', label: 'Section 61 (Spring 2027, Fall 2026)' },
    { value: '62', label: 'Section 62' },
  ])
  assert.deepEqual(requestedSections(rows, '1501215'), [{ value: '61', label: 'Section 61' }])
  assert.deepEqual(requestedSections(rows, null), [])
  // Read completely from Raise_Capacity (not the whole catalog); names from Course for those IDs only.
  assert.match(SERVICE, /supabase\.from\('Raise_Capacity'\)\.select\('Course_ID, Section_ID, Term', \{ count: 'exact' \}\)\.order\('Request_ID'\)\.range\(from, to\)/)
  assert.match(SERVICE, /supabase\.from\('Course'\)\.select\('Course_ID, Course_Name'\)\.in\('Course_ID', ids\.slice\(i, i \+ 100\)\)/)
  // The filters: the requested Course_ID and Section_ID.
  assert.match(ALL, /if \(isRc && filters\.course\) query = query\.eq\('rc\.Course_ID', filters\.course\)/)
  assert.match(ALL, /if \(isRc && filters\.course && filters\.section\) query = query\.eq\('rc\.Section_ID', filters\.section\)/)
})

test('a new or cleared course clears the section; a section needs a course', () => {
  const rc = filters({ type: 'Raise Capacity', course: '1501116', section: '61', priority: 'HIGH', page: 4 })
  assert.deepEqual(applyFilterPatch(rc, { course: '1501215' }), { ...rc, course: '1501215', section: null, page: 1 })
  assert.deepEqual(applyFilterPatch(rc, { course: null }), { ...rc, course: null, section: null, page: 1 })
  assert.deepEqual(applyFilterPatch(rc, { section: '62' }), { ...rc, section: '62', page: 1 })
  assert.equal(parseAllRequestsParams(params('type=Raise+Capacity&section=61')).section, null)
})

// -- 9. Combined filters, database-side paging -----------------------------------------

test('every filter is part of the one counted, paged query (nothing filtered in the browser)', () => {
  const build = ALL.slice(ALL.indexOf('const build = () => {'), ALL.indexOf('await fetchPage(build'))
  for (const part of ["eq('Request_Type'", "eq('Current_Status'", '.Term`', "gte('Request_Date', termFilter.start)",
    "eq('rc.Course_ID'", "eq('rc.Section_ID'", "in('Request_ID', priority.ids)", '.or(orFilter)']) {
    assert.ok(build.includes(part), part)
  }
  // Search + Approved + time window + mixed term combine as AND of OR groups.
  assert.equal(combineOrGroups(['a.eq.1,b.eq.2', 'c.eq.3', 'rcTerm.not.is.null,ieTerm.not.is.null']),
    'and(or(a.eq.1,b.eq.2),or(c.eq.3),or(rcTerm.not.is.null,ieTerm.not.is.null))')
  assert.doesNotMatch(PAGE, /list\.rows\.filter\(\(row\) => row\.(term|priority|course|section)/)
})

// -- 10 / 11. URL state ----------------------------------------------------------------

test('URL: all filters round-trip; invalid values are dropped; dependents are normalized', () => {
  const all = filters({
    search: 'STUD', type: 'Raise Capacity', status: 'Approved', from: '2026-09-01', fromTime: '08:00',
    to: '2026-12-31', toTime: '23:59', term: 202601, priority: 'NOT_ASSESSED', course: '1501116', section: '61', page: 2,
  })
  assert.deepEqual(parseAllRequestsParams(toAllRequestsParams(all)), all)
  // Invalid values.
  const bad = parseAllRequestsParams(params('type=Raise+Capacity&fromTime=25:00&from=2026-09-01&term=999&priority=URGENT&course=%3Cx%3E'))
  assert.equal(bad.fromTime, null)
  assert.equal(bad.term, null)
  assert.equal(bad.priority, null)
  assert.equal(bad.course, null)
  assert.equal(validTime('9:30'), null)
  assert.equal(validTime('09:30'), '09:30')
  // A time without its date, Raise Capacity filters with another type: removed from the URL.
  assert.equal(canonicalAllRequestsParams(params('fromTime=10:00&toTime=11:00')).toString(), '')
  assert.equal(canonicalAllRequestsParams(params('type=Program+Change&priority=HIGH&course=1501116&section=61')).toString(), 'type=Program+Change')
})

test('changing the type away from Raise Capacity clears its filters; every change resets the page', () => {
  const rc = filters({ type: 'Raise Capacity', course: '1501116', section: '61', priority: 'LOW', term: 202601, page: 3 })
  const next = applyFilterPatch(rc, { type: 'Incomplete Exam' })
  assert.deepEqual(next, { ...rc, type: 'Incomplete Exam', priority: null, course: null, section: null, page: 1 })
  assert.equal(applyFilterPatch(rc, { page: 5 }).page, 5)
  // Clearing a date clears its time.
  const timed = filters({ from: '2026-11-01', fromTime: '09:00', to: '2026-11-30', toTime: '18:00' })
  assert.deepEqual(applyFilterPatch(timed, { from: null }), { ...timed, from: null, fromTime: null })
  assert.deepEqual(applyFilterPatch(timed, { to: null }), { ...timed, to: null, toTime: null })
  // Clear filters empties the URL; every filter counts as active.
  assert.match(PAGE, /setParams\(new URLSearchParams\(\), \{ replace: true \}\)/)
  for (const patch of [{ term: 202601 }, { from: '2026-11-01' }, { type: 'Raise Capacity', priority: 'HIGH' as const }]) {
    assert.equal(hasActiveFilters(filters(patch)), true)
  }
  // Returning from a review restores the list from the saved query string.
  assert.match(PAGE, /returnSearch=\{location\.search\}/)
})

// -- 12. Approved unchanged -------------------------------------------------------------

test('the Approved filter still uses the recorded-approval rule alongside the new filters', () => {
  assert.match(ALL, /if \(plan\.kind === 'approved'\) groups\.push\(approvedGroup\(approvedIds\)\)/)
  assert.match(ALL, /needsApprovalIds\(plan\) \? fetchApprovedRequestIds\(\) : Promise\.resolve/)
})

// -- 13. Layout and accessibility -------------------------------------------------------

test('advanced filter count: term, From (with its time) and To (with its time)', () => {
  assert.equal(moreFiltersCount(filters({})), 0)
  assert.equal(moreFiltersCount(filters({ from: '2026-11-01', fromTime: '09:00', term: 202601 })), 2)
  assert.equal(moreFiltersCount(filters({ from: '2026-11-01', to: '2026-11-30', term: 202601 })), 3)
  // Drawer groups: From and To, each a date and time pair.
  assert.match(PAGE, /<legend>From<\/legend>/)
  assert.match(PAGE, /<legend>To<\/legend>/)
})

test('time fields: 24-hour HH:MM, disabled until their date, invalid input never applied', () => {
  assert.match(PAGE, /id="aar-from-time"\s+label="Time"\s+value=\{filters\.fromTime\}\s+disabled=\{!filters\.from\}/)
  assert.match(PAGE, /id="aar-to-time"\s+label="Time"\s+value=\{filters\.toTime\}\s+disabled=\{!filters\.to\}/)
  assert.match(PAGE, /placeholder="HH:MM"/)
  assert.match(PAGE, /else if \(validTime\(text\)\) onChange\(text\)/)
  assert.match(PAGE, /aria-invalid=\{invalid \|\| undefined\}/)
})

test('the term dropdown (no help text) and the Raise Capacity section (only for that type, section disabled until a course)', () => {
  assert.match(PAGE, /<label htmlFor="aar-term">Academic term<\/label>/)
  assert.doesNotMatch(PAGE, /aar-term-help/)
  assert.match(PAGE, /\{isRc && \(\s+<section className="aar-rc" aria-labelledby="aar-rc-title">/)
  assert.match(PAGE, />\s+Raise Capacity filters\s+</)
  assert.match(PAGE, /<option value="">All priorities<\/option>/)
  assert.match(PAGE, /id="aar-section"\s+value=\{filters\.section \?\? ''\}\s+disabled=\{!filters\.course\}/)
  // The shared course dropdown, marked optional here (the student forms keep it required).
  assert.match(PAGE, /<CourseCombobox\s+id="aar-course"[\s\S]*?required=\{false\}/)
  assert.match(COMBO, /required = true,/)
  assert.match(COMBO, /\{required && \(/)
  // Responsive.
  assert.match(CSS, /@media \(max-width: 640px\)/)
})

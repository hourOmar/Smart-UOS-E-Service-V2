// Admin All Requests layout: compact toolbar, the advanced filters drawer
// (dialog semantics, Escape / outside click / Close, focus trap and return,
// scroll lock), Reset advanced filters, active filter chips and the Raise
// Capacity row. Pure helpers are run; the wiring is checked in the source.
// No browser, database or AI. Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  ADVANCED_FILTERS_RESET,
  DEFAULT_ALL_REQUESTS_FILTERS,
  activeFilterChips,
  applyFilterPatch,
  moreFiltersCount,
  parseAllRequestsParams,
  toAllRequestsParams,
  type AllRequestsFilters,
} from '../src/utils/adminAllRequests.ts'
import { FOCUSABLE_SELECTOR, wrapFocusIndex } from '../src/utils/dialogFocus.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const PAGE = read('../src/pages/AdminAllRequests.tsx')
const DRAWER = read('../src/components/admin/FilterDrawer.tsx')
const CSS = read('../src/pages/AdminAllRequests.css')
const filters = (patch: Partial<AllRequestsFilters>): AllRequestsFilters => ({ ...DEFAULT_ALL_REQUESTS_FILTERS, ...patch })

// -- Focus management -------------------------------------------------------------------

test('Tab and Shift+Tab wrap inside the drawer; otherwise the browser moves focus', () => {
  assert.equal(wrapFocusIndex(4, 5, false), 0) // last -> first
  assert.equal(wrapFocusIndex(0, 5, true), 4) // first -> last
  assert.equal(wrapFocusIndex(-1, 5, false), 0) // focus outside the list -> first
  assert.equal(wrapFocusIndex(-1, 5, true), 4)
  assert.equal(wrapFocusIndex(2, 5, false), null)
  assert.equal(wrapFocusIndex(2, 5, true), null)
  assert.equal(wrapFocusIndex(0, 0, false), null)
  for (const part of ['button:not([disabled])', 'select:not([disabled])', 'input:not([disabled])', '[tabindex]:not([tabindex="-1"])']) {
    assert.ok(FOCUSABLE_SELECTOR.includes(part), part)
  }
})

test('the drawer is a labelled modal dialog that takes focus and gives it back', () => {
  assert.match(DRAWER, /role="dialog"\s+aria-modal="true"\s+aria-labelledby=\{titleId\}/)
  assert.match(DRAWER, /<h2 id=\{titleId\} className="aar-drawer__title">/)
  // Focus: the first [data-autofocus] (the term), else the first control; back to the opener on close.
  assert.match(DRAWER, /panel\?\.querySelector<HTMLElement>\('\[data-autofocus\]'\) \?\? focusableIn\(panel\)\[0\] \?\? panel/)
  assert.match(DRAWER, /const opener = returnFocusRef\.current/)
  assert.match(DRAWER, /opener\?\.focus\(\)/)
  assert.match(PAGE, /returnFocusRef=\{moreButtonRef\}/)
  assert.match(PAGE, /id="aar-term"\s+data-autofocus/)
  // Tab is kept inside.
  assert.match(DRAWER, /wrapFocusIndex\(items\.indexOf\(document\.activeElement as HTMLElement\), items\.length, event\.shiftKey\)/)
  // Nothing rendered while closed.
  assert.match(DRAWER, /if \(!open\) return null/)
})

test('Escape, the Close button and a click outside the panel close the drawer', () => {
  assert.match(DRAWER, /if \(event\.key === 'Escape'\) \{\s+event\.stopPropagation\(\)\s+onClose\(\)/)
  assert.match(DRAWER, /<div className="aar-drawer__backdrop" aria-hidden="true" onClick=\{onClose\} \/>/)
  assert.match(DRAWER, /className="aar-drawer__close" aria-label=\{`Close \$\{title\.toLowerCase\(\)\}`\} onClick=\{onClose\}/)
  assert.match(PAGE, /<button type="button" className="aar-drawer__done" onClick=\{closeDrawer\}>\s+Done\s+<\/button>/)
})

test('the page behind does not scroll while the drawer is open (and is restored after)', () => {
  // The student layout (.student) is the scroll container.
  assert.match(DRAWER, /const scroller = panel\?\.closest<HTMLElement>\('\.student'\) \?\? null/)
  assert.match(DRAWER, /if \(scroller\) scroller\.style\.overflowY = 'hidden'/)
  assert.match(DRAWER, /document\.body\.style\.overflow = 'hidden'/)
  assert.match(DRAWER, /if \(scroller\) scroller\.style\.overflowY = previousScroller\s+document\.body\.style\.overflow = previousBody/)
  // It overlays the page (fixed, above the header), not pushing the table down.
  assert.match(CSS, /\.aar-drawer \{\s+position: fixed;\s+inset: 0;\s+z-index: 80;/)
  assert.match(CSS, /\.aar-drawer__panel \{\s+position: absolute;\s+top: 0;\s+right: 0;\s+bottom: 0;/)
  // No dependency added for it.
  assert.doesNotMatch(read('../package.json'), /focus-trap|headlessui|radix|react-modal/)
})

// -- Toolbar and drawer contents ------------------------------------------------------------

test('toolbar: search, type, status, sort and the More filters button with its active count', () => {
  const toolbar = PAGE.slice(PAGE.indexOf('<div className="aar-toolbar">'), PAGE.indexOf('{isRc && ('))
  for (const id of ['aar-q', 'aar-type', 'aar-status', 'aar-sort']) assert.match(toolbar, new RegExp(`id="${id}"`), id)
  assert.match(toolbar, /className="aar-morebtn"\s+aria-haspopup="dialog"\s+aria-expanded=\{drawerOpen\}\s+onClick=\{\(\) => setDrawerOpen\(true\)\}/)
  assert.match(toolbar, /More filters\s+\{advancedCount > 0 && \(\s+<span className="aar-morebtn__count">\s+\{advancedCount\}/)
  // No big Clear filters button, no inline advanced panel.
  assert.doesNotMatch(PAGE, /Clear filters|aar-more__panel|aar-more__toggle/)
})

test('drawer: Advanced filters, term, Submission date and time with From / To pairs (no explanatory notes)', () => {
  assert.match(PAGE, /titleId="aar-drawer-title"\s+title="Advanced filters"/)
  const body = PAGE.slice(PAGE.indexOf('<FilterDrawer'))
  for (const id of ['aar-term', 'aar-from', 'aar-from-time', 'aar-to', 'aar-to-time']) assert.match(body, new RegExp(`id="${id}"`), id)
  assert.match(body, /<h3 className="aar-drawer__subtitle">Submission date and time<\/h3>/)
  assert.doesNotMatch(body, /UTC\+4|semester of submission|aar-term-help|aar-time-note/)
  assert.match(body, /<fieldset className="aar-group">\s+<legend>From<\/legend>/)
  assert.match(body, /<fieldset className="aar-group">\s+<legend>To<\/legend>/)
  // Times still disabled until their dates.
  assert.match(body, /disabled=\{!filters\.from\}/)
  assert.match(body, /disabled=\{!filters\.to\}/)
})

test('Reset advanced filters clears only the term and the submission window', () => {
  const before = filters({
    search: 'STUD', type: 'Raise Capacity', status: 'Approved', sort: 'oldest', priority: 'HIGH', course: '1501116',
    section: '61', term: 202601, from: '2026-11-01', fromTime: '09:00', to: '2026-11-30', toTime: '18:00', page: 3,
  })
  const after = applyFilterPatch(before, ADVANCED_FILTERS_RESET)
  assert.deepEqual(after, { ...before, term: null, from: null, fromTime: null, to: null, toTime: null, page: 1 })
  assert.equal(moreFiltersCount(after), 0)
  assert.match(PAGE, /onClick=\{\(\) => apply\(ADVANCED_FILTERS_RESET\)\}\s+disabled=\{advancedCount === 0\}/)
  assert.match(PAGE, />\s+Reset advanced filters\s+</)
})

// -- Active filter chips --------------------------------------------------------------------

test('chips: one readable chip per active filter, none when unfiltered', () => {
  assert.deepEqual(activeFilterChips(filters({})), [])
  const chips = activeFilterChips(filters({
    type: 'Raise Capacity', status: 'Approved', priority: 'HIGH', course: '1501116', section: '61', term: 202601,
    from: '2026-11-01', fromTime: '09:00', to: '2026-11-30', search: 'U24', sort: 'oldest',
  }))
  assert.deepEqual(chips.map((c) => c.label), [
    'Raise Capacity', 'Approved', 'High Priority', 'Course 1501116', 'Section 61', 'Fall 2026',
    'From Nov 1, 2026, 09:00', 'To Nov 30, 2026', 'Search: U24', 'Oldest first',
  ])
  assert.equal(activeFilterChips(filters({ type: 'Raise Capacity', priority: 'NOT_ASSESSED' }))[1].label, 'Not Assessed Priority')
})

test('removing a chip clears only that filter (Course also clears Section; Type clears the Raise Capacity filters)', () => {
  const state = filters({ type: 'Raise Capacity', status: 'Rejected', priority: 'LOW', course: '1501116', section: '61', term: 202602, page: 2 })
  const remove = (key: string) => {
    const chip = activeFilterChips(state).find((c) => c.key === key)
    assert.ok(chip, key)
    return applyFilterPatch(state, chip.remove)
  }
  assert.deepEqual(remove('status'), { ...state, status: null, page: 1 })
  assert.deepEqual(remove('section'), { ...state, section: null, page: 1 })
  assert.deepEqual(remove('course'), { ...state, course: null, section: null, page: 1 })
  assert.deepEqual(remove('term'), { ...state, term: null, page: 1 })
  assert.deepEqual(remove('type'), { ...state, type: null, priority: null, course: null, section: null, page: 1 })
  // The URL follows (chips go through the same apply / URL path).
  assert.equal(toAllRequestsParams(remove('course')).get('section'), null)
  assert.match(PAGE, /aria-label=\{`Remove filter: \$\{chip\.label\}`\}\s+onClick=\{\(\) => apply\(chip\.remove\)\}/)
  // Shown only when there is something to show, with Clear all.
  assert.match(PAGE, /\{chips\.length > 0 && \(\s+<div className="aar-chips">/)
  assert.match(PAGE, /onClick=\{clearFilters\}>\s+Clear all\s+</)
})

// -- Raise Capacity row, URL state, table, responsiveness ----------------------------------

test('Raise Capacity filters: compact, left-aligned row, only for that type', () => {
  assert.match(PAGE, /\{isRc && \(\s+<section className="aar-rc" aria-labelledby="aar-rc-title">/)
  assert.match(CSS, /\.aar-rc__fields \{\s+display: flex;\s+flex-wrap: wrap;\s+align-items: flex-start;\s+justify-content: flex-start;/)
  // Priority and Section ~180px, Course ~320px.
  assert.match(CSS, /\.aar-rc__fields > \.aar-field \{\s+flex: 0 1 180px;/)
  assert.match(CSS, /\.aar-course \{\s+display: flex;\s+flex: 0 1 320px;/)
  // The course dropdown matches the selects' height and label, and its list stays readable.
  assert.match(CSS, /\.aar-course \.cec-combo__input\.rc-field__input \{\s+min-height: 40px;/)
  assert.match(CSS, /\.aar-course \.rc-field__label \{\s+font-size: 13px;\s+font-weight: 600;/)
  assert.match(CSS, /\.aar-course \.cec-combo__panel \{\s+right: auto;\s+width: max\(100%, 380px\);\s+max-width: calc\(100vw - 32px\);/)
  assert.match(PAGE, /id="aar-section"\s+value=\{filters\.section \?\? ''\}\s+disabled=\{!filters\.course\}/)
})

test('the drawer state is not in the URL; all filter parameters are unchanged', () => {
  assert.doesNotMatch(PAGE, /set\('drawer'|drawer=/)
  const all = filters({ type: 'Raise Capacity', term: 202601, from: '2026-11-01', fromTime: '09:00', priority: 'HIGH', course: '1501116', section: '61' })
  assert.equal(toAllRequestsParams(all).toString(),
    'type=Raise+Capacity&from=2026-11-01&fromTime=09%3A00&term=202601&priority=HIGH&course=1501116&section=61')
  assert.deepEqual(parseAllRequestsParams(toAllRequestsParams(all)), all)
})

test('the requests table is unchanged', () => {
  const headers = [...PAGE.matchAll(/<th scope="col"[^>]*>\s*([^<]+?)\s*</g)].map((m) => m[1])
  assert.deepEqual(headers, ['Request ID', 'Student Name', 'Student ID', 'Request Type', 'Submission Date', 'Status', 'Priority', 'Action'])
})

test('mobile: toolbar in two columns with full-width search, stacked Raise Capacity row, full-width drawer', () => {
  const mobile = CSS.slice(CSS.indexOf('@media (max-width: 640px)'))
  assert.match(mobile, /\.aar-toolbar \{\s+display: grid;\s+grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/)
  assert.match(mobile, /\.adm-listsearch\.aar-search \{\s+grid-column: 1 \/ -1;/)
  assert.match(mobile, /\.aar-rc__fields > \.aar-field,\s+\.aar-course \{\s+flex: 1 1 100%;/)
  assert.match(mobile, /\.aar-drawer__panel \{\s+width: 100%;/)
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/)
  // Less space above the table.
  assert.match(CSS, /\.adm-page\.aar-page \{\s+gap: 14px;/)
})

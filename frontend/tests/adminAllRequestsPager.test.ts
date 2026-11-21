// The All Requests pager: 20 per page, at most three page numbers between the
// arrows, arrows that move one real page, and a number window that shifts only
// when the active page would leave it. No browser, database or AI.
// Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { PAGE_WINDOW_SIZE, pageWindow, pageWindowStart } from '../src/utils/pageWindow.ts'
import { ALL_REQUESTS_PAGE_SIZE, DEFAULT_ALL_REQUESTS_FILTERS, applyFilterPatch } from '../src/utils/adminAllRequests.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const PAGER = read('../src/components/admin/WindowedPager.tsx')
const PAGE = read('../src/pages/AdminAllRequests.tsx')
const CSS = read('../src/pages/AdminAllRequests.css')

// Simulates the pager: each step moves to a page; returns [active, numbers] after each.
function walk(pages: number, steps: number[], first = 1) {
  let start = pageWindowStart(1, first, pages)
  return steps.map((page) => {
    start = pageWindowStart(start, page, pages)
    return [page, pageWindow(start, pages)] as const
  })
}

test('10 requests per page, three numbers at most', () => {
  assert.equal(ALL_REQUESTS_PAGE_SIZE, 10)
  assert.equal(PAGE_WINDOW_SIZE, 3)
  assert.deepEqual(pageWindow(pageWindowStart(1, 1, 10), 10), [1, 2, 3])
})

test('Next: 1 2 3 stays while pages 1-3 are active, then shifts one at a time', () => {
  assert.deepEqual(walk(10, [2, 3, 4, 5]), [
    [2, [1, 2, 3]],
    [3, [1, 2, 3]],
    [4, [2, 3, 4]],
    [5, [3, 4, 5]],
  ])
})

test('Previous: the reverse, shifting only when the active page would leave the window', () => {
  // From page 5 (window 3 4 5) back to page 1.
  assert.deepEqual(walk(10, [5, 4, 3, 2, 1]).slice(1), [
    [4, [3, 4, 5]],
    [3, [3, 4, 5]],
    [2, [2, 3, 4]],
    [1, [1, 2, 3]],
  ])
})

test('a visible number goes straight to that page (window unchanged)', () => {
  assert.deepEqual(walk(10, [3]), [[3, [1, 2, 3]]])
  assert.deepEqual(walk(10, [4, 2]), [[4, [2, 3, 4]], [2, [2, 3, 4]]])
})

test('never a page that does not exist', () => {
  assert.deepEqual(pageWindow(1, 1), [1])
  assert.deepEqual(pageWindow(1, 2), [1, 2])
  assert.deepEqual(walk(4, [2, 3, 4]).at(-1), [4, [2, 3, 4]])
  // Fewer pages after a filter change: the window is pulled back inside.
  assert.equal(pageWindowStart(5, 2, 3), 1)
  assert.deepEqual(pageWindow(pageWindowStart(5, 2, 3), 3), [1, 2, 3])
  // A deep link opens with the page at the end of the window.
  assert.deepEqual(pageWindow(pageWindowStart(1, 7, 10), 10), [5, 6, 7])
})

test('arrows move one page and are disabled at the ends; numbers go to their page', () => {
  assert.match(PAGER, /aria-label="Previous page"\s+onClick=\{\(\) => onPageChange\(page - 1\)\}\s+disabled=\{page <= 1\}/)
  assert.match(PAGER, /aria-label="Next page"\s+onClick=\{\(\) => onPageChange\(page \+ 1\)\}\s+disabled=\{page >= pages\}/)
  assert.match(PAGER, /aria-current=\{n === page \? 'page' : undefined\}\s+aria-label=\{`Page \$\{n\}`\}\s+onClick=\{\(\) => onPageChange\(n\)\}/)
  assert.match(PAGER, /setStart\(pageWindowStart\(start, page, pages\)\)/)
  // No rows-per-page choice.
  assert.doesNotMatch(PAGER + PAGE, /rows per page|perPage|pageSize=/i)
})

test('the page uses it with the same range text, URL page and database paging', () => {
  assert.match(PAGE, /<WindowedPager\s+label="All requests pages"\s+rangeText=\{`Showing \$\{first\}–\$\{last\} of \$\{list\.total\}/)
  assert.match(PAGE, /onPageChange=\{\(page\) => apply\(\{ page \}\)\}/)
  assert.doesNotMatch(PAGE, /import Pager from/)
  // Filter or sort changes go back to page 1.
  const onPage3 = { ...DEFAULT_ALL_REQUESTS_FILTERS, page: 3 }
  assert.equal(applyFilterPatch(onPage3, { sort: 'oldest' }).page, 1)
  assert.equal(applyFilterPatch(onPage3, { status: 'Approved' }).page, 1)
  // The per-type lists use the same sliding pager.
  assert.match(read('../src/pages/AdminTypeRequests.tsx'), /import WindowedPager from '\.\.\/components\/admin\/WindowedPager'/)
})

test('round buttons: outlined pages, a dark filled active page', () => {
  assert.match(CSS, /\.aar-pager__arrow,\s+\.aar-pager__page \{[^}]*border: 1px solid #c9d0cb;[^}]*border-radius: 50%;[^}]*background: #ffffff;/)
  assert.match(CSS, /\.aar-pager__page\[aria-current='page'\] \{\s+border-color: #1d2a33;\s+background: #1d2a33;\s+color: #ffffff;/)
  assert.match(CSS, /\.aar-pager__arrow:disabled \{\s+opacity: 0\.4;/)
})

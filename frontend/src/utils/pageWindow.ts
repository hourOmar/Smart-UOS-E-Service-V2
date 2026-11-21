// The sliding window of page numbers in the All Requests pager: at most
// `size` consecutive numbers, moved only when the active page would fall
// outside it, and never past the last page. Kept free of React and network
// imports so it can be tested on its own (tests/adminAllRequestsPager.test.ts).

export const PAGE_WINDOW_SIZE = 3

/**
 * The first number of the window for the active page, given the previous
 * window's first number: unchanged while the page is inside it, shifted just
 * enough otherwise (to end on the page going forward, to start on it going
 * back), and kept within 1..pages.
 */
export function pageWindowStart(previousStart: number, page: number, pages: number, size = PAGE_WINDOW_SIZE): number {
  const last = Math.max(1, pages)
  const current = Math.min(Math.max(1, page), last)
  let start = Math.max(1, previousStart)
  if (current < start) start = current
  if (current > start + size - 1) start = current - size + 1
  return Math.min(Math.max(1, start), Math.max(1, last - size + 1))
}

/** The page numbers shown from `start` (never a page that does not exist). */
export function pageWindow(start: number, pages: number, size = PAGE_WINDOW_SIZE): number[] {
  const last = Math.max(1, pages)
  const from = Math.min(Math.max(1, start), last)
  const to = Math.min(last, from + size - 1)
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

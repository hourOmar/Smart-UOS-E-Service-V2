// Keyboard focus inside a modal dialog (e.g. the All Requests filter drawer).
// Kept free of DOM and network imports so it can be tested on its own
// (tests/adminAllRequestsDrawer.test.ts).

/** Elements that can take keyboard focus inside a dialog. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Where Tab should move focus so it never leaves the dialog: from the last
 * element to the first (Shift+Tab: first to last), and to the first (or last)
 * when focus is not on any of them. Null = let the browser move it normally.
 */
export function wrapFocusIndex(current: number, count: number, backwards: boolean): number | null {
  if (count <= 0) return null
  if (backwards) return current <= 0 ? count - 1 : null
  return current < 0 || current >= count - 1 ? 0 : null
}

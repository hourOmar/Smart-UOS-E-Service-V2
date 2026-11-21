import { useEffect, useRef } from 'react'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { FOCUSABLE_SELECTOR, wrapFocusIndex } from '../../utils/dialogFocus'

interface FilterDrawerProps {
  open: boolean
  onClose: () => void
  /** Id of the dialog's title (aria-labelledby). */
  titleId: string
  title: string
  /** The control that opened the drawer; focus returns to it on close. */
  returnFocusRef: RefObject<HTMLElement | null>
  children: ReactNode
  footer: ReactNode
}

const focusableIn = (root: HTMLElement | null) =>
  root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : []

// A modal drawer sliding in from the right (no dependencies): labelled dialog,
// focus moved in on open and back to the opener on close, Tab kept inside,
// Escape / Close / a click on the backdrop close it, and the page behind it
// does not scroll while it is open. The page's scroll container is the
// student layout (.student), so that is what is locked.
function FilterDrawer({ open, onClose, titleId, title, returnFocusRef, children, footer }: FilterDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const opener = returnFocusRef.current
    const scroller = panel?.closest<HTMLElement>('.student') ?? null
    const previousScroller = scroller?.style.overflowY ?? ''
    const previousBody = document.body.style.overflow
    if (scroller) scroller.style.overflowY = 'hidden'
    document.body.style.overflow = 'hidden'

    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? focusableIn(panel)[0] ?? panel
    first?.focus()

    return () => {
      if (scroller) scroller.style.overflowY = previousScroller
      document.body.style.overflow = previousBody
      opener?.focus()
    }
  }, [open, returnFocusRef])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const items = focusableIn(panelRef.current)
    const next = wrapFocusIndex(items.indexOf(document.activeElement as HTMLElement), items.length, event.shiftKey)
    if (items.length === 0) event.preventDefault()
    else if (next !== null) {
      event.preventDefault()
      items[next].focus()
    }
  }

  if (!open) return null

  return (
    <div className="aar-drawer" onKeyDown={handleKeyDown}>
      <div className="aar-drawer__backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        className="aar-drawer__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="aar-drawer__header">
          <h2 id={titleId} className="aar-drawer__title">
            {title}
          </h2>
          <button type="button" className="aar-drawer__close" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="aar-drawer__body">{children}</div>
        <div className="aar-drawer__footer">{footer}</div>
      </div>
    </div>
  )
}

export default FilterDrawer

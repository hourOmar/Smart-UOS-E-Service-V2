import { useState } from 'react'
import { pageWindow, pageWindowStart } from '../../utils/pageWindow'

interface WindowedPagerProps {
  /** Accessible name of the navigation, e.g. "All requests pages". */
  label: string
  /** "Showing 1–20 of 45 requests" */
  rangeText: string
  page: number
  pages: number
  onPageChange: (page: number) => void
}

// The All Requests pager: range text, a previous arrow, at most three page
// numbers and a next arrow. The arrows move one page at a time; the numbers
// shift only when the active page would leave them (utils/pageWindow.ts).
function WindowedPager({ label, rangeText, page, pages, onPageChange }: WindowedPagerProps) {
  const [start, setStart] = useState(() => pageWindowStart(1, page, pages))
  const [shown, setShown] = useState({ page, pages })
  if (shown.page !== page || shown.pages !== pages) {
    setShown({ page, pages })
    setStart(pageWindowStart(start, page, pages))
  }
  const numbers = pageWindow(start, pages)

  return (
    <nav className="adm-pager aar-pager" aria-label={label}>
      <span className="adm-pager__range" aria-live="polite">
        {rangeText}
      </span>
      <div className="aar-pager__buttons">
        <button
          type="button"
          className="aar-pager__arrow"
          aria-label="Previous page"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M12.5 5l-5 5 5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {numbers.map((n) => (
          <button
            key={n}
            type="button"
            className="aar-pager__page"
            aria-current={n === page ? 'page' : undefined}
            aria-label={`Page ${n}`}
            onClick={() => onPageChange(n)}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          className="aar-pager__arrow"
          aria-label="Next page"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M7.5 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </nav>
  )
}

export default WindowedPager

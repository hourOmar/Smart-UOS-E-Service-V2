interface PagerProps {
  /** Accessible name of the navigation, e.g. "Pending requests pages". */
  label: string
  /** "Showing 1–6 of 14 …" */
  rangeText: string
  page: number
  pages: number
  onPageChange: (page: number) => void
}

// The prototype's pager: range text, Previous, page numbers and Next.
function Pager({ label, rangeText, page, pages, onPageChange }: PagerProps) {
  return (
    <nav className="adm-pager" aria-label={label}>
      <span className="adm-pager__range" aria-live="polite">
        {rangeText}
      </span>
      <div className="adm-pager__buttons">
        <button
          type="button"
          className="adm-pager__step"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          ← Previous
        </button>
        {Array.from({ length: pages }, (_, index) => index + 1).map((n) => (
          <button
            key={n}
            type="button"
            className="adm-pager__page"
            aria-current={n === page ? 'page' : undefined}
            aria-label={`Page ${n}`}
            onClick={() => onPageChange(n)}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          className="adm-pager__step"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
        >
          Next →
        </button>
      </div>
    </nav>
  )
}

export default Pager

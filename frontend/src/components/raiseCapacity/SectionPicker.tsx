import { useMemo, useState } from 'react'
import type { RaiseCapacitySection } from '../../services/raiseCapacity'
import { seatStatus } from '../../utils/sectionCapacity'
import { CURRENT_TERM } from '../../config/academicTerm'

interface SectionPickerProps {
  status: 'loading' | 'ready' | 'error'
  sections: RaiseCapacitySection[]
  onRetry: () => void
  selectedKey: string | null
  onSelect: (key: string) => void
  /** Validation message ("Select a course section."), as in the prototype. */
  error?: string | null
}

// Left column: search and choose a course section (full or open).
function SectionPicker({
  status,
  sections,
  onRetry,
  selectedKey,
  onSelect,
  error,
}: SectionPickerProps) {
  const [query, setQuery] = useState('')

  // Search by course ID or course name, as in the prototype.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sections
    return sections.filter((section) =>
      `${section.courseId} ${section.courseName}`.toLowerCase().includes(q),
    )
  }, [query, sections])

  return (
    <section className="rc-panel rc-picker" aria-labelledby="rc-picker-title">
      <div className="rc-picker__head">
        <div className="rc-panel__title-row">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM13 4h5.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H13z" />
          </svg>
          <h2 id="rc-picker-title" className="rc-panel__title">
            Select Course
          </h2>
        </div>

        <div className="rc-picker__search">
          <label htmlFor="rc-search" className="student-visually-hidden">
            Search by course name or code
          </label>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            id="rc-search"
            type="search"
            placeholder="Search by course name or code"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={status !== 'ready' || sections.length === 0}
          />
        </div>

        <div className="rc-picker__legend" aria-hidden="true">
          <span>
            <span className="rc-picker__dot rc-picker__dot--full" />
            Full
          </span>
          <span>
            <span className="rc-picker__dot rc-picker__dot--open" />
            Seats available
          </span>
        </div>
      </div>

      {error && (
        <p id="rc-sel-err" className="rc-error rc-picker__error">
          <span aria-hidden="true">✕ </span>
          {error}
        </p>
      )}

      <div className="rc-picker__body">
        {status === 'loading' && (
          <p className="rc-picker__state" role="status">
            Loading course sections…
          </p>
        )}

        {status === 'error' && (
          <div className="rc-picker__state" role="alert">
            <p>We couldn’t load the course sections.</p>
            <button type="button" className="rc-button" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}

        {status === 'ready' && sections.length === 0 && (
          <p className="rc-picker__state" role="status">
            No course sections are available for term {CURRENT_TERM}.
          </p>
        )}

        {status === 'ready' && sections.length > 0 && (
          <div
            className="rc-picker__list"
            role="radiogroup"
            aria-label="Course sections"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'rc-sel-err' : undefined}
          >
            {visible.map((section) => {
              const seats = seatStatus(
                section.currentCapacity,
                section.totalCapacity,
              )
              const selected = section.key === selectedKey

              return (
                <label
                  key={section.key}
                  className="rc-option"
                  data-selected={selected}
                >
                  <input
                    type="radio"
                    name="rc-section"
                    className="student-visually-hidden"
                    checked={selected}
                    onChange={() => onSelect(section.key)}
                  />
                  <span className="rc-option__top">
                    <span className="rc-option__code">{section.courseId}</span>
                    <span className="rc-option__chip">
                      Section {section.sectionId}
                    </span>
                  </span>
                  <span className="rc-option__name">{section.courseName}</span>
                  <span className="rc-option__meta">
                    <span>
                      Seats:{' '}
                      <strong>
                        {section.currentCapacity} / {section.totalCapacity}
                      </strong>{' '}
                      · {section.term}
                    </span>
                    <span className="rc-badge" data-full={seats.full}>
                      <span aria-hidden="true">{seats.full ? '●' : '○'}</span>
                      {seats.label}
                    </span>
                  </span>
                  {selected && (
                    <span className="rc-option__check" aria-hidden="true">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m6 12.5 4 4 8-9" />
                      </svg>
                    </span>
                  )}
                </label>
              )
            })}

            {visible.length === 0 && (
              <p className="rc-picker__no-match" role="status">
                No sections match “{query.trim()}”.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

export default SectionPicker

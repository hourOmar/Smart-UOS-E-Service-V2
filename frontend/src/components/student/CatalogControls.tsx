import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import './CatalogControls.css'

// Controls shared by the Academic Requests catalogs of the student and admin
// dashboards, following the final prototype (v3).

interface QuickSearchProps {
  id: string
  /** Visually hidden label. */
  label: string
  value: string
  onChange: (value: string) => void
  /** Clears the query (and anything tied to it); focus returns to the field. */
  onClear: () => void
  /** Result count shown at the right, e.g. "20 services". */
  countLabel: string
}

// Quick search: filters as the student types; Escape or × clears it.
export function QuickSearch({ id, label, value, onChange, onClear, countLabel }: QuickSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && value) {
      event.preventDefault()
      onChange('')
    }
  }

  const handleClear = () => {
    onClear()
    inputRef.current?.focus()
  }

  return (
    <div className="catalog-search" role="search">
      <label htmlFor={id} className="student-visually-hidden">
        {label}
      </label>
      <svg
        className="catalog-search__icon"
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
        ref={inputRef}
        id={id}
        className="catalog-search__input"
        type="text"
        role="searchbox"
        enterKeyHint="search"
        autoComplete="off"
        placeholder="Quick search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-describedby={`${id}-count`}
      />
      {value && (
        <button
          type="button"
          className="catalog-search__clear"
          onClick={handleClear}
          aria-label="Clear search"
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </button>
      )}
      <span id={`${id}-count`} className="catalog-search__count" aria-live="polite">
        {countLabel}
      </span>
    </div>
  )
}

interface ShowMoreToggleProps {
  open: boolean
  /** Cards hidden while collapsed. */
  hiddenCount: number
  onToggle: () => void
}

export function ShowMoreToggle({ open, hiddenCount, onToggle }: ShowMoreToggleProps) {
  return (
    <button type="button" className="catalog-more" aria-expanded={open} onClick={onToggle}>
      {open ? 'Show less' : `Show more (${hiddenCount})`}
      <span aria-hidden="true">{open ? '↑' : '↓'}</span>
    </button>
  )
}

interface CatalogNoMatchProps {
  title: string
  onClear: () => void
}

export function CatalogNoMatch({ title, onClear }: CatalogNoMatchProps) {
  return (
    <div className="catalog-empty">
      <h3 className="catalog-empty__title">{title}</h3>
      <button type="button" className="catalog-empty__clear" onClick={onClear}>
        Clear search
      </button>
    </div>
  )
}

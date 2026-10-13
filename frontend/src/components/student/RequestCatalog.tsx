import type { FormEvent } from 'react'
import type { AcademicRequestType } from '../../data/academicRequests'
import RequestCard from './RequestCard'

interface RequestCatalogProps {
  id: string
  requests: AcademicRequestType[]
  query: string
  onQueryChange: (value: string) => void
  onClearSearch: () => void
}

function RequestCatalog({
  id,
  requests,
  query,
  onQueryChange,
  onClearSearch,
}: RequestCatalogProps) {
  // Filtering happens as the student types; Enter has nothing extra to do.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
  }

  return (
    <section
      id={id}
      className="student-catalog"
      aria-labelledby="student-catalog-title"
    >
      <div className="student-shell">
        <header className="student-catalog__header">
          <h2 id="student-catalog-title" className="student-catalog__title">
            <span className="student-catalog__title-accent">Academic</span>{' '}
            Requests
          </h2>
          <p className="student-catalog__intro">
            Choose a request to see what it involves, or start it directly.
          </p>
        </header>

        <form className="student-search" role="search" onSubmit={handleSubmit}>
          <label
            htmlFor="student-search-input"
            className="student-visually-hidden"
          >
            Quick search
          </label>
          <svg
            className="student-search__icon"
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
            id="student-search-input"
            className="student-search__input"
            type="search"
            placeholder="Quick search"
            autoComplete="off"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            aria-describedby="student-search-count"
          />
          <span
            id="student-search-count"
            className="student-search__count"
            aria-live="polite"
          >
            {requests.length} {requests.length === 1 ? 'service' : 'services'}
          </span>
        </form>

        {requests.length > 0 ? (
          <ul className="student-catalog__grid">
            {requests.map((request) => (
              <li key={request.id} className="student-catalog__item">
                <RequestCard request={request} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="student-catalog__empty">
            <h3 className="student-catalog__empty-title">
              No requests match “{query.trim()}”
            </h3>
            <p className="student-catalog__empty-body">
              Try another word, such as “grade”, “exam” or “course”.
            </p>
            <button
              type="button"
              className="student-catalog__clear"
              onClick={onClearSearch}
            >
              Clear search
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

export default RequestCatalog

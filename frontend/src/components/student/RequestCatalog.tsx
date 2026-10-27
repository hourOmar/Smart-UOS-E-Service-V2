import { useState } from 'react'
import {
  CATALOG_INITIAL_CARDS,
  type AcademicRequestType,
  type FutureService,
} from '../../data/academicRequests'
import { CatalogNoMatch, QuickSearch, ShowMoreToggle } from './CatalogControls'
import RequestCard, { FutureServiceCard } from './RequestCard'

/** One catalog card: a real service, or one planned for a future release. */
export type CatalogEntry =
  | { kind: 'service'; request: AcademicRequestType }
  | { kind: 'future'; service: FutureService }

interface RequestCatalogProps {
  id: string
  /** Matching cards, in display order. */
  entries: CatalogEntry[]
  query: string
  onQueryChange: (value: string) => void
  onClearSearch: () => void
  /** A real service without a form, or a future service, was opened. */
  onUnavailable: (name: string, kind: CatalogEntry['kind']) => void
}

// Academic Requests (prototype v3): heading with the quick search on its
// right, then the first nine cards and Show more. While searching, every
// match is shown.
function RequestCatalog({
  id,
  entries,
  query,
  onQueryChange,
  onClearSearch,
  onUnavailable,
}: RequestCatalogProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const searching = query.trim() !== ''
  const canMore = !searching && entries.length > CATALOG_INITIAL_CARDS
  const shown = searching || moreOpen ? entries : entries.slice(0, CATALOG_INITIAL_CARDS)

  const handleClear = () => {
    onClearSearch()
    setMoreOpen(false)
  }

  return (
    <section
      id={id}
      className="student-catalog"
      aria-labelledby="student-catalog-title"
    >
      <div className="student-catalog__inner">
        <div className="catalog-head">
          <div className="catalog-head__text">
            <h2 id="student-catalog-title" className="catalog-head__title">
              <span className="catalog-head__accent">Academic</span> Requests
            </h2>
            <p className="catalog-head__intro">
              Choose a request to see what it involves, or start it directly.
            </p>
          </div>
          <QuickSearch
            id="student-search-input"
            label="Quick search"
            value={query}
            onChange={onQueryChange}
            onClear={handleClear}
            countLabel={`${entries.length} ${entries.length === 1 ? 'service' : 'services'}`}
          />
        </div>

        {entries.length === 0 ? (
          <CatalogNoMatch
            title="No matching services found. Try a different keyword."
            onClear={handleClear}
          />
        ) : (
          <ul className="student-catalog__grid">
            {shown.map((entry) => (
              <li
                key={entry.kind === 'service' ? entry.request.id : entry.service.name}
                className="student-catalog__item"
              >
                {entry.kind === 'service' ? (
                  <RequestCard
                    request={entry.request}
                    onUnavailable={(request) => onUnavailable(request.name, 'service')}
                  />
                ) : (
                  <FutureServiceCard
                    service={entry.service}
                    onOpen={(service) => onUnavailable(service.name, 'future')}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {canMore && (
          <ShowMoreToggle
            open={moreOpen}
            hiddenCount={entries.length - CATALOG_INITIAL_CARDS}
            onToggle={() => setMoreOpen((open) => !open)}
          />
        )}
      </div>
    </section>
  )
}

export default RequestCatalog

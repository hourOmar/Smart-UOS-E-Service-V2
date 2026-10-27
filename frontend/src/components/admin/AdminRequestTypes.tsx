import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  academicRequestTypes,
  futureServices,
  CATALOG_INITIAL_CARDS,
  type AcademicRequestType,
  type FutureService,
} from '../../data/academicRequests'
import { adminTypePath } from '../../utils/adminPaths'
import { rankServices, scoreService } from '../../utils/serviceSearch'
import type { RequestTypeCount } from '../../services/adminRequests'
import { CatalogNoMatch, QuickSearch, ShowMoreToggle } from '../student/CatalogControls'
import RequestIcon from '../student/RequestIcon'

interface AdminRequestTypesProps {
  status: 'loading' | 'ready' | 'error'
  counts: RequestTypeCount[]
  onRetry: () => void
  /** A request type planned for a future release was opened. */
  onUnavailable: (service: FutureService) => void
}

type TypeEntry =
  | { kind: 'type'; type: AcademicRequestType }
  | { kind: 'future'; service: FutureService }

// The five real request types, then those planned for a future release, in
// the final prototype's order.
const ENTRIES: TypeEntry[] = [
  ...academicRequestTypes.map((type) => ({ kind: 'type' as const, type })),
  ...futureServices.map((service) => ({ kind: 'future' as const, service })),
]

const entryName = (entry: TypeEntry) => (entry.kind === 'type' ? entry.type.name : entry.service.name)

// "Academic Requests" on the admin home (prototype v3): heading with a quick
// search of the type names on its right, one card per request type with its
// real total and In Progress count, and "View requests" opening that type's
// list. The first nine cards are shown until Show more.
function AdminRequestTypes({ status, counts, onRetry, onUnavailable }: AdminRequestTypesProps) {
  const [query, setQuery] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const byType = new Map(counts.map((count) => [count.type, count]))

  const entries = useMemo(
    () => rankServices(ENTRIES, (entry) => scoreService(query, entryName(entry))),
    [query],
  )
  const searching = query.trim() !== ''
  const canMore = !searching && entries.length > CATALOG_INITIAL_CARDS
  const shown = searching || moreOpen ? entries : entries.slice(0, CATALOG_INITIAL_CARDS)

  const handleClear = () => {
    setQuery('')
    setMoreOpen(false)
  }

  return (
    <section className="adm-types" aria-labelledby="adm-types-title">
      <div className="catalog-head">
        <div className="catalog-head__text">
          <h2 id="adm-types-title" className="catalog-head__title">
            <span className="catalog-head__accent">Academic</span> Requests
          </h2>
          <p className="catalog-head__intro">Browse submissions by request type.</p>
        </div>
        <QuickSearch
          id="adm-types-search"
          label="Quick search request types"
          value={query}
          onChange={setQuery}
          onClear={handleClear}
          countLabel={`${entries.length} ${entries.length === 1 ? 'request type' : 'request types'}`}
        />
      </div>

      {status === 'error' ? (
        <div className="req-state" role="alert">
          <h3 className="req-state__title">We couldn’t load the request totals.</h3>
          <p className="req-state__body">Check your connection and try again.</p>
          <button type="button" className="req-button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : entries.length === 0 ? (
        <CatalogNoMatch title="No matching request types found." onClear={handleClear} />
      ) : (
        <div className="adm-types__grid" aria-busy={status === 'loading' || undefined}>
          {shown.map((entry) => {
            if (entry.kind === 'future') {
              const { service } = entry
              return (
                <article key={service.name} className="adm-type">
                  <div className="adm-type__body">
                    <span className="adm-type__icon">
                      <RequestIcon path={service.icon} />
                    </span>
                    <div className="adm-type__text">
                      <h3 className="adm-type__name">{service.name}</h3>
                      <span className="adm-type__unavailable">Not yet available</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="adm-type__open"
                    aria-disabled="true"
                    aria-label={`View ${service.name} requests (not yet available)`}
                    onClick={() => onUnavailable(service)}
                  >
                    View requests<span aria-hidden="true">→</span>
                  </button>
                </article>
              )
            }

            const { type } = entry
            const count = byType.get(type.name)
            return (
              <article key={type.id} className="adm-type">
                <div className="adm-type__body">
                  <span className="adm-type__icon">
                    <RequestIcon id={type.id} />
                  </span>
                  <div className="adm-type__text">
                    <h3 className="adm-type__name">{type.name}</h3>
                    {status === 'loading' || !count ? (
                      <span className="adm-type__loading">Loading totals…</span>
                    ) : (
                      <div className="adm-type__counts">
                        <span className="adm-type__total">
                          <strong>{count.total}</strong>{' '}
                          {count.total === 1 ? 'submission' : 'submissions'}
                        </span>
                        <span className="adm-type__progress">
                          {count.inProgress} in progress
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <Link
                  to={adminTypePath(type.id)}
                  className="adm-type__open"
                  aria-label={`View ${type.name} requests`}
                >
                  View requests<span aria-hidden="true">→</span>
                </Link>
              </article>
            )
          })}
        </div>
      )}

      {canMore && status !== 'error' && (
        <ShowMoreToggle
          open={moreOpen}
          hiddenCount={entries.length - CATALOG_INITIAL_CARDS}
          onToggle={() => setMoreOpen((open) => !open)}
        />
      )}
    </section>
  )
}

export default AdminRequestTypes

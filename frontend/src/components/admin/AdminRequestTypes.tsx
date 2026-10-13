import { Link } from 'react-router-dom'
import { academicRequestTypes } from '../../data/academicRequests'
import { adminTypePath } from '../../utils/adminPaths'
import type { RequestTypeCount } from '../../services/adminRequests'
import RequestIcon from '../student/RequestIcon'

interface AdminRequestTypesProps {
  status: 'loading' | 'ready' | 'error'
  counts: RequestTypeCount[]
  onRetry: () => void
}

// "Academic Requests" on the admin home: one card per request type with
// its real total and In Progress count, and "View requests" opening that
// type's list.
function AdminRequestTypes({ status, counts, onRetry }: AdminRequestTypesProps) {
  const byType = new Map(counts.map((count) => [count.type, count]))

  return (
    <section className="adm-types" aria-labelledby="adm-types-title">
      <div className="adm-types__head">
        <h2 id="adm-types-title" className="adm-types__title">
          <span className="adm-types__accent">Academic</span> Requests
        </h2>
        <p className="adm-types__intro">Browse submissions by request type.</p>
      </div>

      {status === 'error' ? (
        <div className="req-state" role="alert">
          <h3 className="req-state__title">We couldn’t load the request totals.</h3>
          <p className="req-state__body">Check your connection and try again.</p>
          <button type="button" className="req-button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : (
        <div className="adm-types__grid" aria-busy={status === 'loading' || undefined}>
          {academicRequestTypes.map((type) => {
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
                          {count.inProgress} In Progress
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
    </section>
  )
}

export default AdminRequestTypes

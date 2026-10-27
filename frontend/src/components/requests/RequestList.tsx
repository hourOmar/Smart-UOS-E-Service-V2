import { Link } from 'react-router-dom'
import { formatDate, type StudentRequestRow } from '../../services/studentRequests'
import { requestDetailsPath, type RequestsOrigin } from '../../utils/requestPaths'
import RequestStatusBadge from './RequestStatusBadge'
import './Requests.css'

interface RequestListProps {
  status: 'loading' | 'ready' | 'error'
  requests: StudentRequestRow[]
  onRetry: () => void
  /** Where the list is shown, so the details page can link back to it. */
  origin: RequestsOrigin
  /** Heading of the first column (the dashboard says "Request Reference"). */
  idHeading?: string
  /**
   * Adds the Course / Program column (dashboard, prototype v3). Its values
   * by request ID; null while they load.
   */
  targets?: ReadonlyMap<string, string> | null
  showTarget?: boolean
}

// The signed-in student's requests: a table on wide screens and cards on
// narrow ones (as in the prototype), plus loading, empty and error states.
function RequestList({
  status,
  requests,
  onRetry,
  origin,
  idHeading = 'Request ID',
  targets = null,
  showTarget = false,
}: RequestListProps) {
  if (status === 'loading') {
    return (
      <div className="req-state" role="status">
        <p className="req-state__body">Loading your requests…</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="req-state" role="alert">
        <h3 className="req-state__title">We couldn’t load your requests.</h3>
        <p className="req-state__body">Check your connection and try again.</p>
        <button type="button" className="req-button" onClick={onRetry}>
          Try again
        </button>
      </div>
    )
  }

  if (requests.length === 0) {
    return (
      <div className="req-state">
        <span className="req-state__icon" aria-hidden="true">
          ○
        </span>
        <h3 className="req-state__title">You haven’t submitted any requests yet.</h3>
        <p className="req-state__body">
          Requests you submit will appear here so you can track them.
        </p>
      </div>
    )
  }

  const linkState = { from: origin }
  // Blank while loading; a dash when the request has no recorded subject.
  const targetOf = (id: string) => (targets ? targets.get(id) || '—' : '')

  return (
    <>
      <div className="req-table-wrap">
        <table className="req-table">
          <thead>
            <tr>
              <th scope="col">{idHeading}</th>
              <th scope="col">Request Type</th>
              {showTarget && <th scope="col">Course / Program</th>}
              <th scope="col">Submitted Date</th>
              <th scope="col">Status</th>
              <th scope="col" className="req-table__view">
                View
              </th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td className="req-table__id">{request.id}</td>
                <td className="req-table__type">{request.type}</td>
                {showTarget && <td className="req-table__target">{targetOf(request.id)}</td>}
                <td className="req-table__date">{formatDate(request.date)}</td>
                <td>
                  <RequestStatusBadge status={request.status} requestType={request.type} />
                </td>
                <td className="req-table__view">
                  <Link
                    to={requestDetailsPath(request.id)}
                    state={linkState}
                    className="req-view"
                    aria-label={`View request ${request.id}`}
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="req-cards">
        {requests.map((request) => (
          <li key={request.id} className="req-card">
            <div className="req-card__top">
              <span className="req-card__id">{request.id}</span>
              <RequestStatusBadge status={request.status} requestType={request.type} />
            </div>
            <span className="req-card__type">{request.type}</span>
            {showTarget && targetOf(request.id) && (
              <span className="req-card__target">{targetOf(request.id)}</span>
            )}
            <div className="req-card__bottom">
              <span className="req-card__date">Submitted {formatDate(request.date)}</span>
              <Link
                to={requestDetailsPath(request.id)}
                state={linkState}
                className="req-view"
                aria-label={`View request ${request.id}`}
              >
                View
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

export default RequestList

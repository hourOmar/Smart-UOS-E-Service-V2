import { Link } from 'react-router-dom'
import usePendingRequests from '../../hooks/usePendingRequests'
import useRaiseCapacityPriorities from '../../hooks/useRaiseCapacityPriorities'
import { IN_PROGRESS, PENDING_LIMIT } from '../../services/adminRequests'
import { formatDate } from '../../services/studentRequests'
import { ALL_REQUESTS_PATH } from '../../utils/adminPaths'
import RequestStatusBadge from '../requests/RequestStatusBadge'
import PriorityCell, { PriorityNotice } from './PriorityCell'
import ReviewAction from './ReviewAction'

// The 10 most recently submitted In Progress requests of every type, newest
// first (no filter, no pages); "View all requests" opens the full list.
function PendingRequests() {
  const { status, rows, total, retry } = usePendingRequests()
  // Priorities for the visible Raise Capacity rows only (staff-only backend).
  const priorities = useRaiseCapacityPriorities(
    status === 'ready' ? rows.filter((row) => row.type === 'Raise Capacity').map((row) => row.id) : [],
  )

  return (
    <section className="adm-pending" aria-labelledby="adm-pending-title">
      <div className="adm-pending__inner">
        <div className="adm-pending__head">
          <div className="adm-pending__heading">
            <h2 id="adm-pending-title" className="adm-pending__title">
              Pending Requests
            </h2>
            <p className="adm-pending__intro">
              The {PENDING_LIMIT} most recent submissions awaiting a decision, across all request types.
            </p>
          </div>
          {/* Same text link as the student dashboard's Recent Requests. */}
          <Link to={ALL_REQUESTS_PATH} className="student-recent__all">
            View all requests
            <span aria-hidden="true">→</span>
          </Link>
        </div>

        {status === 'loading' && (
          <div className="req-state" role="status">
            <p className="req-state__body">Loading pending requests…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="req-state" role="alert">
            <h3 className="req-state__title">We couldn’t load the pending requests.</h3>
            <p className="req-state__body">Check your connection and try again.</p>
            <button type="button" className="req-button" onClick={retry}>
              Try again
            </button>
          </div>
        )}

        {status === 'ready' && total === 0 && (
          <div className="req-state">
            <span className="req-state__icon" aria-hidden="true">
              ○
            </span>
            <h3 className="req-state__title">No {IN_PROGRESS} requests.</h3>
            <p className="req-state__body">Every request has a recorded decision.</p>
          </div>
        )}

        {status === 'ready' && total > 0 && (
          <>
            <PriorityNotice priorities={priorities} />
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">Request ID</th>
                    <th scope="col">Student Name</th>
                    <th scope="col">Student ID</th>
                    <th scope="col">Request Type</th>
                    <th scope="col">Submitted Date</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="adm-table__prio">Priority</th>
                    <th scope="col" className="adm-table__review">
                      Review
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="adm-table__id">{row.id}</td>
                      <td className="adm-table__name">{row.studentName ?? '—'}</td>
                      <td className="adm-table__sid">{row.studentId}</td>
                      <td className="adm-table__type">{row.type}</td>
                      <td className="adm-table__date">{formatDate(row.date)}</td>
                      <td>
                        <RequestStatusBadge
                          status={row.status}
                          requestType={row.type}
                          approvalRecorded={row.approvalRecorded}
                        />
                      </td>
                      <td className="adm-table__prio">
                        <PriorityCell requestId={row.id} requestType={row.type} priorities={priorities} />
                      </td>
                      <td className="adm-table__review">
                        <ReviewAction requestId={row.id} requestType={row.type} origin="dashboard" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="adm-pending__count" aria-live="polite">
              Showing {rows.length} of {total} {IN_PROGRESS}
            </p>
          </>
        )}
      </div>
    </section>
  )
}

export default PendingRequests

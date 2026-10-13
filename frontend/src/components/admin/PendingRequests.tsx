import usePendingRequests from '../../hooks/usePendingRequests'
import useRaiseCapacityPriorities from '../../hooks/useRaiseCapacityPriorities'
import {
  IN_PROGRESS,
  PENDING_PAGE_SIZE,
  REQUEST_TYPE_NAMES,
  type RequestTypeCount,
} from '../../services/adminRequests'
import { formatDate } from '../../services/studentRequests'
import RequestStatusBadge from '../requests/RequestStatusBadge'
import Pager from './Pager'
import PriorityCell, { PriorityNotice } from './PriorityCell'
import ReviewAction from './ReviewAction'

interface PendingRequestsProps {
  /** In Progress counts per type, for the filter's option labels. */
  counts: RequestTypeCount[]
  type: string | null
  page: number
  onTypeChange: (type: string | null) => void
  onPageChange: (page: number) => void
}

// Every In Progress request across all types, newest first, with a type
// filter and pages of six. "Review" opens the review page for Raise Capacity;
// other types stay disabled until theirs exists.
function PendingRequests({ counts, type, page, onTypeChange, onPageChange }: PendingRequestsProps) {
  // shownPage can be lower than page if that page no longer exists.
  const { status, rows, total, page: shownPage, retry } = usePendingRequests(type, page)
  const inProgressByType = new Map(counts.map((count) => [count.type, count.inProgress]))
  // Priorities for the visible Raise Capacity rows only (staff-only backend).
  const priorities = useRaiseCapacityPriorities(
    status === 'ready' ? rows.filter((row) => row.type === 'Raise Capacity').map((row) => row.id) : [],
  )

  const pages = Math.max(1, Math.ceil(total / PENDING_PAGE_SIZE))
  const first = (shownPage - 1) * PENDING_PAGE_SIZE + 1
  const last = Math.min(shownPage * PENDING_PAGE_SIZE, total)

  return (
    <section className="adm-pending" aria-labelledby="adm-pending-title">
      <div className="adm-pending__inner">
        <div className="adm-pending__head">
          <div className="adm-pending__heading">
            <h2 id="adm-pending-title" className="adm-pending__title">
              Pending Requests
            </h2>
            <p className="adm-pending__intro">
              Every submission awaiting a decision, across all request types.
            </p>
          </div>
          <div className="adm-pending__filter">
            <label htmlFor="adm-pending-type">Request type</label>
            <select
              id="adm-pending-type"
              value={type ?? ''}
              onChange={(event) => onTypeChange(event.target.value || null)}
            >
              <option value="">All types</option>
              {REQUEST_TYPE_NAMES.map((name) => (
                <option key={name} value={name}>
                  {inProgressByType.has(name) ? `${name} (${inProgressByType.get(name)})` : name}
                </option>
              ))}
            </select>
          </div>
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
            <p className="req-state__body">
              {type
                ? `Every ${type} request has a recorded decision.`
                : 'Every request has a recorded decision.'}
            </p>
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
                        <RequestStatusBadge status={row.status} requestType={row.type} />
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

            <Pager
              label="Pending requests pages"
              rangeText={`Showing ${first}–${last} of ${total} ${IN_PROGRESS}`}
              page={shownPage}
              pages={pages}
              onPageChange={onPageChange}
            />
          </>
        )}
      </div>
    </section>
  )
}

export default PendingRequests

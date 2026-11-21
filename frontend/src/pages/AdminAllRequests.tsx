import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import useStaffIdentity from '../hooks/useStaffIdentity'
import useAllRequests from '../hooks/useAllRequests'
import useRaiseCapacityPriorities from '../hooks/useRaiseCapacityPriorities'
import { formatDate } from '../services/studentRequests'
import { ADMIN_HOME_PATH, ADMIN_MENU_ITEMS } from '../utils/adminPaths'
import {
  ALL_REQUESTS_PAGE_SIZE,
  ALL_REQUEST_TYPES,
  FILTER_STATUSES,
  dateRangeError,
  hasActiveFilters,
  parseAllRequestsParams,
  toAllRequestsParams,
  type AllRequestsFilters,
  type DisplayStatus,
  type SortOrder,
} from '../utils/adminAllRequests'
import StudentLayout from '../components/student/StudentLayout'
import RequestStatusBadge from '../components/requests/RequestStatusBadge'
import Pager from '../components/admin/Pager'
import ReviewAction from '../components/admin/ReviewAction'
import PriorityCell, { PriorityNotice } from '../components/admin/PriorityCell'
import { AllRequestsBreadcrumb } from '../components/admin/ReviewBreadcrumb'
import '../components/requests/Requests.css'
import './AdminDashboard.css'
import './AdminAllRequests.css'

// Typing pauses this long before the list is searched.
const SEARCH_DELAY_MS = 300

// Every request of every type and status (/admin/requests): search, filters,
// sort and pages, all kept in the URL so a review's way back (and the
// browser's Back) restores the same list. Filtering, counting and paging
// happen in the database (services/adminRequests.ts fetchAllRequests); the
// status filter matches the badges (utils/adminAllRequests.ts).
function AdminAllRequests() {
  const identity = useStaffIdentity()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const filters = parseAllRequestsParams(params)
  const rangeError = dateRangeError(filters.from, filters.to)
  const list = useAllRequests(filters, rangeError === null)

  // Saved priorities of the visible Raise Capacity rows; read only: this list
  // never starts a priority check.
  const priorities = useRaiseCapacityPriorities(
    list.status === 'ready' ? list.rows.filter((row) => row.type === 'Raise Capacity').map((row) => row.id) : [],
    { autoStart: false },
  )

  // Any change returns to page 1 unless it sets the page itself.
  const apply = useCallback(
    (patch: Partial<AllRequestsFilters>) =>
      setParams((prev) => toAllRequestsParams({ ...parseAllRequestsParams(prev), page: 1, ...patch }), {
        replace: true,
      }),
    [setParams],
  )

  // The search box follows the URL (e.g. after Clear filters or Back) and
  // searches as the admin types, after a short pause.
  const [query, setQuery] = useState(filters.search)
  const [shownSearch, setShownSearch] = useState(filters.search)
  if (shownSearch !== filters.search) {
    setShownSearch(filters.search)
    setQuery(filters.search)
  }
  useEffect(() => {
    const next = query.trim()
    if (next === filters.search) return
    const timer = window.setTimeout(() => apply({ search: next }), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [query, filters.search, apply])

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    apply({ search: query.trim() })
  }

  const clearFilters = () => {
    setQuery('')
    setParams(new URLSearchParams(), { replace: true })
  }

  const filtered = hasActiveFilters(filters)
  // list.page can be lower than requested if that page no longer exists.
  const pages = Math.max(1, Math.ceil(list.total / ALL_REQUESTS_PAGE_SIZE))
  const first = (list.page - 1) * ALL_REQUESTS_PAGE_SIZE + 1
  const last = Math.min(list.page * ALL_REQUESTS_PAGE_SIZE, list.total)

  return (
    <StudentLayout profile={identity} solidHeader homePath={ADMIN_HOME_PATH} menuItems={ADMIN_MENU_ITEMS}>
      <div className="adm-page">
        <AllRequestsBreadcrumb />

        <div className="adm-cat__heading">
          <h1 className="adm-cat__title">All Requests</h1>
          <p className="adm-cat__summary">Every request of every type and status, newest first by default.</p>
        </div>

        <div className="aar-tools">
          <form role="search" className="adm-listsearch aar-search" onSubmit={handleSearchSubmit}>
            <label htmlFor="aar-q" className="student-visually-hidden">
              Search by request ID or student ID
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
              id="aar-q"
              type="search"
              placeholder="Search request ID or student ID"
              autoComplete="off"
              maxLength={100}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </form>

          <div className="aar-field">
            <label htmlFor="aar-type">Request type</label>
            <select
              id="aar-type"
              value={filters.type ?? ''}
              onChange={(event) => apply({ type: event.target.value || null })}
            >
              <option value="">All types</option>
              {ALL_REQUEST_TYPES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="aar-field">
            <label htmlFor="aar-status">Status</label>
            <select
              id="aar-status"
              value={filters.status ?? ''}
              onChange={(event) => apply({ status: (event.target.value || null) as DisplayStatus | null })}
            >
              <option value="">All statuses</option>
              {FILTER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <div className="aar-field">
            <label htmlFor="aar-from">Submitted from</label>
            <input
              id="aar-from"
              type="date"
              value={filters.from ?? ''}
              max={filters.to ?? undefined}
              onChange={(event) => apply({ from: event.target.value || null })}
            />
          </div>

          <div className="aar-field">
            <label htmlFor="aar-to">Submitted to</label>
            <input
              id="aar-to"
              type="date"
              value={filters.to ?? ''}
              min={filters.from ?? undefined}
              onChange={(event) => apply({ to: event.target.value || null })}
            />
          </div>

          <div className="aar-field">
            <label htmlFor="aar-sort">Sort</label>
            <select
              id="aar-sort"
              value={filters.sort}
              onChange={(event) => apply({ sort: event.target.value as SortOrder })}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>

          <button
            type="button"
            className="req-button aar-clear"
            onClick={clearFilters}
            disabled={!filtered && filters.page === 1}
          >
            Clear filters
          </button>
        </div>

        {rangeError && (
          <p className="aar-error" role="alert">
            {rangeError}
          </p>
        )}

        {list.status === 'loading' && (
          <div className="req-state" role="status">
            <p className="req-state__body">Loading requests…</p>
          </div>
        )}

        {list.status === 'error' && (
          <div className="req-state" role="alert">
            <h2 className="req-state__title">We couldn’t load these requests.</h2>
            <p className="req-state__body">Check your connection and try again.</p>
            <button type="button" className="req-button" onClick={list.retry}>
              Try again
            </button>
          </div>
        )}

        {list.status === 'ready' && list.total === 0 && (
          <div className="req-state">
            <span className="req-state__icon" aria-hidden="true">
              ○
            </span>
            {filtered ? (
              <>
                <h2 className="req-state__title">No requests match these filters.</h2>
                <p className="req-state__body">Try another search term, type, status or date range.</p>
              </>
            ) : (
              <>
                <h2 className="req-state__title">No requests yet.</h2>
                <p className="req-state__body">Requests will appear here when students submit them.</p>
              </>
            )}
          </div>
        )}

        {list.status === 'ready' && list.total > 0 && (
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
                    <th scope="col">Submission Date</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="adm-table__prio">Priority</th>
                    <th scope="col" className="adm-table__review">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((row) => (
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
                        <ReviewAction
                          requestId={row.id}
                          requestType={row.type}
                          origin="all-requests"
                          returnSearch={location.search}
                          label={row.status === 'In Progress' ? 'Review' : 'View'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pager
              label="All requests pages"
              rangeText={`Showing ${first}–${last} of ${list.total}${filtered ? ' matching' : ''} ${
                list.total === 1 ? 'request' : 'requests'
              }`}
              page={list.page}
              pages={pages}
              onPageChange={(page) => apply({ page })}
            />
          </>
        )}
      </div>
    </StudentLayout>
  )
}

export default AdminAllRequests

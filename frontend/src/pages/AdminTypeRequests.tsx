import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { academicRequestTypes } from '../data/academicRequests'
import useStaffIdentity from '../hooks/useStaffIdentity'
import useTypeStatusCounts from '../hooks/useTypeStatusCounts'
import useTypeRequests from '../hooks/useTypeRequests'
import useRaiseCapacityPriorities from '../hooks/useRaiseCapacityPriorities'
import {
  IN_PROGRESS,
  REQUEST_STATUSES,
  TYPE_PAGE_SIZE,
} from '../services/adminRequests'
import { formatDate } from '../services/studentRequests'
import { ADMIN_HOME_ITEM, ADMIN_HOME_PATH } from '../utils/adminPaths'
import StudentLayout from '../components/student/StudentLayout'
import RequestIcon from '../components/student/RequestIcon'
import RequestStatusBadge from '../components/requests/RequestStatusBadge'
import Pager from '../components/admin/Pager'
import ReviewAction from '../components/admin/ReviewAction'
import PriorityCell, { PriorityNotice } from '../components/admin/PriorityCell'
import { statusLabel } from '../utils/statusLabels'
import '../components/requests/Requests.css'
import './AdminDashboard.css'

// Typing pauses this long before the list is searched.
const SEARCH_DELAY_MS = 300

// All requests of one type (from "View requests" on the admin home), newest
// first, with status tabs, search and pagination, following the prototype.
function AdminTypeRequests() {
  const { typeId } = useParams()
  const requestType = academicRequestTypes.find((type) => type.id === typeId) ?? null
  const identity = useStaffIdentity()

  return (
    <StudentLayout profile={identity} solidHeader homePath={ADMIN_HOME_PATH} menuItems={[ADMIN_HOME_ITEM]}>
      <div className="adm-page">
        <Link to={ADMIN_HOME_PATH} className="req-page__back">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M13.5 8.5 10 12l3.5 3.5" />
          </svg>
          Admin home
        </Link>

        {requestType ? (
          <TypeRequestList key={requestType.id} requestType={requestType} />
        ) : (
          <div className="req-state">
            <span className="req-state__icon" aria-hidden="true">
              ○
            </span>
            <h1 className="req-state__title">Request type not found</h1>
            <p className="req-state__body">Choose a request type from the admin home.</p>
            <Link to={ADMIN_HOME_PATH} className="req-view">
              Go to Admin home
            </Link>
          </div>
        )}
      </div>
    </StudentLayout>
  )
}

function TypeRequestList({ requestType }: { requestType: (typeof academicRequestTypes)[number] }) {
  const type = requestType.name
  const [statusTab, setStatusTab] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const counts = useTypeStatusCounts(type)
  const list = useTypeRequests(type, statusTab, search, page)
  // The Priority column exists only on the Raise Capacity list (staff-only backend).
  const showPriority = type === 'Raise Capacity'
  const priorities = useRaiseCapacityPriorities(
    showPriority && list.status === 'ready' ? list.rows.map((row) => row.id) : [],
  )

  // Search as the admin types, after a short pause.
  useEffect(() => {
    const next = query.trim()
    if (next === search) return
    const timer = window.setTimeout(() => {
      setSearch(next)
      setPage(1)
    }, SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [query, search])

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSearch(query.trim())
    setPage(1)
  }

  const selectTab = (status: string | null) => {
    setStatusTab(status)
    setPage(1)
  }

  const allCount = counts.counts?.all ?? null
  const inProgressCount = counts.counts?.byStatus[IN_PROGRESS] ?? null
  const tabs: { label: string; status: string | null; count: number | null }[] = [
    { label: 'All', status: null, count: allCount },
    // Filters use the stored status; the tab shows its label for this type.
    ...REQUEST_STATUSES.map((status) => ({
      label: statusLabel(status, type),
      status,
      count: counts.counts?.byStatus[status] ?? null,
    })),
  ]

  const filtered = statusTab !== null || search !== ''
  // list.page can be lower than page if that page no longer exists.
  const pages = Math.max(1, Math.ceil(list.total / TYPE_PAGE_SIZE))
  const first = (list.page - 1) * TYPE_PAGE_SIZE + 1
  const last = Math.min(list.page * TYPE_PAGE_SIZE, list.total)

  return (
    <>
      <div className="adm-cat__head">
        <span className="adm-cat__icon">
          <RequestIcon id={requestType.id} />
        </span>
        <div className="adm-cat__heading">
          <h1 className="adm-cat__title">{type} requests</h1>
          <p className="adm-cat__summary">
            {counts.status === 'ready' && allCount !== null
              ? `${allCount} ${allCount === 1 ? 'submission' : 'submissions'} · ${inProgressCount ?? 0} ${IN_PROGRESS}`
              : counts.status === 'error'
                ? 'Totals are unavailable.'
                : 'Loading totals…'}
          </p>
        </div>
      </div>

      <div className="adm-cat__tools">
        <div className="adm-tabs" role="group" aria-label="Filter by status">
          {tabs.map((tab) => (
            <button
              key={tab.label}
              type="button"
              className="adm-tab"
              aria-pressed={statusTab === tab.status}
              onClick={() => selectTab(tab.status)}
            >
              {tab.label}
              {tab.count !== null && <span className="adm-tab__count">{tab.count}</span>}
            </button>
          ))}
          {counts.status === 'error' && (
            <button type="button" className="adm-tab adm-tab--retry" onClick={counts.retry}>
              Reload counts
            </button>
          )}
        </div>

        <form role="search" className="adm-listsearch" onSubmit={handleSearchSubmit}>
          <label htmlFor="adm-cat-q" className="student-visually-hidden">
            Search this list
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
            id="adm-cat-q"
            type="search"
            placeholder="Search ID, student or course"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
      </div>

      {list.status === 'loading' && (
        <div className="req-state" role="status">
          <p className="req-state__body">Loading {type} requests…</p>
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
              <p className="req-state__body">Try another status or search term.</p>
            </>
          ) : (
            <>
              <h2 className="req-state__title">No {type} requests yet.</h2>
              <p className="req-state__body">
                Requests of this type will appear here when students submit them.
              </p>
            </>
          )}
        </div>
      )}

      {list.status === 'ready' && list.total > 0 && (
        <>
          {showPriority && <PriorityNotice priorities={priorities} />}
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Request ID</th>
                  <th scope="col">Student Name</th>
                  <th scope="col">Student ID</th>
                  <th scope="col">Course / Program</th>
                  <th scope="col">Submitted Date</th>
                  <th scope="col">Status</th>
                  {showPriority && <th scope="col" className="adm-table__prio">Priority</th>}
                  <th scope="col" className="adm-table__review">
                    Review
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="adm-table__id">{row.id}</td>
                    <td className="adm-table__name">{row.studentName ?? '—'}</td>
                    <td className="adm-table__sid">{row.studentId}</td>
                    <td>{row.target ?? '—'}</td>
                    <td className="adm-table__date">{formatDate(row.date)}</td>
                    <td>
                      <RequestStatusBadge status={row.status} requestType={type} />
                    </td>
                    {showPriority && (
                      <td className="adm-table__prio">
                        <PriorityCell requestId={row.id} requestType={type} priorities={priorities} />
                      </td>
                    )}
                    <td className="adm-table__review">
                      <ReviewAction requestId={row.id} requestType={type} origin="type-list" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pager
            label={`${type} requests pages`}
            rangeText={`Showing ${first}–${last} of ${list.total}${filtered ? ' matching' : ''} ${
              list.total === 1 ? 'request' : 'requests'
            }`}
            page={list.page}
            pages={pages}
            onPageChange={setPage}
          />
        </>
      )}
    </>
  )
}

export default AdminTypeRequests

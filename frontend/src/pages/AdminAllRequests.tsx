import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import useStaffIdentity from '../hooks/useStaffIdentity'
import useAllRequests from '../hooks/useAllRequests'
import useAllRequestsFilterOptions from '../hooks/useAllRequestsFilterOptions'
import useRaiseCapacityPriorities from '../hooks/useRaiseCapacityPriorities'
import { formatDate } from '../services/studentRequests'
import { ADMIN_HOME_PATH, ADMIN_MENU_ITEMS } from '../utils/adminPaths'
import {
  ADVANCED_FILTERS_RESET,
  ALL_REQUESTS_PAGE_SIZE,
  ALL_REQUEST_TYPES,
  FILTER_STATUSES,
  PRIORITY_FILTERS,
  PRIORITY_FILTER_LABELS,
  RAISE_CAPACITY,
  activeFilterChips,
  applyFilterPatch,
  canonicalAllRequestsParams,
  dateRangeError,
  hasActiveFilters,
  moreFiltersCount,
  parseAllRequestsParams,
  requestedSections,
  termOptions,
  toAllRequestsParams,
  validTime,
  validTerm,
  type AllRequestsFilters,
  type DisplayStatus,
  type PriorityFilter,
  type SortOrder,
} from '../utils/adminAllRequests'
import StudentLayout from '../components/student/StudentLayout'
import RequestStatusBadge from '../components/requests/RequestStatusBadge'
import WindowedPager from '../components/admin/WindowedPager'
import ReviewAction from '../components/admin/ReviewAction'
import PriorityCell, { PriorityNotice } from '../components/admin/PriorityCell'
import { AllRequestsBreadcrumb } from '../components/admin/ReviewBreadcrumb'
import FilterDrawer from '../components/admin/FilterDrawer'
import CourseCombobox from '../components/courseEquivalency/CourseCombobox'
import '../components/requests/Requests.css'
import './AdminDashboard.css'
import './RaiseCapacityForm.css'
import './AdminAllRequests.css'

// Typing pauses this long before the list is searched.
const SEARCH_DELAY_MS = 300

// A 24-hour HH:MM time box (UAE time). It applies a time only once it is
// complete and valid; it is disabled until its date is chosen.
function TimeField({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: string | null
  disabled: boolean
  onChange: (time: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setDraft(value ?? '')
  }
  const invalid = draft !== '' && validTime(draft) === null
  return (
    <div className="aar-field aar-field--time">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        placeholder="HH:MM"
        maxLength={5}
        autoComplete="off"
        value={disabled ? '' : draft}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-help`}
        onChange={(event) => {
          const text = event.target.value
          setDraft(text)
          if (text === '') onChange(null)
          else if (validTime(text)) onChange(text)
        }}
      />
      <span id={`${id}-help`} className={invalid ? 'aar-help aar-help--error' : 'aar-help'}>
        {invalid ? 'Use 24-hour HH:MM, e.g. 14:30.' : disabled ? 'Choose a date first.' : '24-hour'}
      </span>
    </div>
  )
}

// Every request of every type and status (/admin/requests): search, filters,
// sort and pages, all kept in the URL so a review's way back (and the
// browser's Back) restores the same list. Filtering, counting and paging
// happen in the database (services/adminRequests.ts fetchAllRequests); the
// status filter matches the badges (utils/adminAllRequests.ts). Layout: a
// compact toolbar, the Raise Capacity filters (that type only), active filter
// chips, and the advanced filters in a right-side drawer.
function AdminAllRequests() {
  const identity = useStaffIdentity()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const filters = parseAllRequestsParams(params)
  const rangeError = dateRangeError(filters.from, filters.to, filters.fromTime, filters.toTime)
  const list = useAllRequests(filters, rangeError === null)
  const filterOptions = useAllRequestsFilterOptions()
  const isRc = filters.type === RAISE_CAPACITY

  // Saved priorities of the visible Raise Capacity rows; read only: this list
  // never starts a priority check.
  const priorities = useRaiseCapacityPriorities(
    list.status === 'ready' ? list.rows.filter((row) => row.type === 'Raise Capacity').map((row) => row.id) : [],
    { autoStart: false },
  )

  // Keep the URL in step with the controls: dropped or invalid values (e.g. a
  // Raise Capacity filter with another type) are removed from it.
  useEffect(() => {
    const canonical = canonicalAllRequestsParams(params)
    if (canonical.toString() !== params.toString()) setParams(canonical, { replace: true })
  }, [params, setParams])

  // Any change returns to page 1 unless it sets the page itself; dependent
  // filters are cleared (utils/adminAllRequests.ts applyFilterPatch).
  const apply = useCallback(
    (patch: Partial<AllRequestsFilters>) =>
      setParams((prev) => toAllRequestsParams(applyFilterPatch(parseAllRequestsParams(prev), patch)), {
        replace: true,
      }),
    [setParams],
  )

  // The search box follows the URL (e.g. after Clear all or Back) and
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

  // Advanced filters drawer.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  const advancedCount = moreFiltersCount(filters)

  // Filter options from the requests themselves.
  const options = filterOptions.options
  const termsForType = options
    ? filters.type
      ? (options.termsByType[filters.type] ?? [])
      : Object.values(options.termsByType).flat()
    : []
  const terms = termOptions(filters.term !== null ? [...termsForType, filters.term] : termsForType)
  const sections = requestedSections(options?.raiseCapacityTargets ?? [], filters.course)
  const sectionChoices =
    filters.section && !sections.some((s) => s.value === filters.section)
      ? [...sections, { value: filters.section, label: `Section ${filters.section}` }]
      : sections

  const chips = activeFilterChips(filters)
  const filtered = hasActiveFilters(filters)
  // list.page can be lower than requested if that page no longer exists.
  const pages = Math.max(1, Math.ceil(list.total / ALL_REQUESTS_PAGE_SIZE))
  const first = (list.page - 1) * ALL_REQUESTS_PAGE_SIZE + 1
  const last = Math.min(list.page * ALL_REQUESTS_PAGE_SIZE, list.total)

  return (
    <StudentLayout profile={identity} solidHeader homePath={ADMIN_HOME_PATH} menuItems={ADMIN_MENU_ITEMS}>
      <div className="adm-page aar-page">
        <AllRequestsBreadcrumb />

        <h1 className="adm-cat__title">All Requests</h1>

        <div className="aar-filters">
          <div className="aar-toolbar">
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

            <div className="aar-field aar-field--compact">
              <label htmlFor="aar-type" className="student-visually-hidden">
                Request type
              </label>
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

            <div className="aar-field aar-field--compact">
              <label htmlFor="aar-status" className="student-visually-hidden">
                Status
              </label>
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

            <div className="aar-field aar-field--compact">
              <label htmlFor="aar-sort" className="student-visually-hidden">
                Sort
              </label>
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
              ref={moreButtonRef}
              type="button"
              className="aar-morebtn"
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path d="M3 5h14M6 10h8M8.5 15h3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              More filters
              {advancedCount > 0 && (
                <span className="aar-morebtn__count">
                  {advancedCount}
                  <span className="student-visually-hidden"> active</span>
                </span>
              )}
            </button>
          </div>

          {isRc && (
            <section className="aar-rc" aria-labelledby="aar-rc-title">
              <h2 id="aar-rc-title" className="aar-rc__title">
                Raise Capacity filters
              </h2>
              <div className="aar-rc__fields">
                <div className="aar-field">
                  <label htmlFor="aar-priority">Priority</label>
                  <select
                    id="aar-priority"
                    value={filters.priority ?? ''}
                    onChange={(event) => apply({ priority: (event.target.value || null) as PriorityFilter | null })}
                  >
                    <option value="">All priorities</option>
                    {PRIORITY_FILTERS.map((priority) => (
                      <option key={priority} value={priority}>
                        {PRIORITY_FILTER_LABELS[priority]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="aar-course">
                  <CourseCombobox
                    id="aar-course"
                    label="Course"
                    placeholder={filterOptions.status === 'loading' ? 'Loading courses…' : 'Search course ID or name'}
                    courses={options?.courses ?? []}
                    selectedId={filters.course}
                    onSelect={(courseId) => apply({ course: courseId })}
                    error={filterOptions.status === 'error' ? 'Courses couldn’t load.' : null}
                    disabled={filterOptions.status !== 'ready'}
                    required={false}
                  />
                  {filters.course && (
                    <button type="button" className="aar-link" onClick={() => apply({ course: null })}>
                      Clear course
                    </button>
                  )}
                </div>

                <div className="aar-field">
                  <label htmlFor="aar-section">Section</label>
                  <select
                    id="aar-section"
                    value={filters.section ?? ''}
                    disabled={!filters.course}
                    aria-describedby="aar-section-help"
                    onChange={(event) => apply({ section: event.target.value || null })}
                  >
                    <option value="">All sections</option>
                    {sectionChoices.map((section) => (
                      <option key={section.value} value={section.value}>
                        {section.label}
                      </option>
                    ))}
                  </select>
                  <span id="aar-section-help" className="aar-help">
                    {filters.course ? 'Sections with requests for this course.' : 'Choose a course first.'}
                  </span>
                </div>
              </div>
            </section>
          )}

          {chips.length > 0 && (
            <div className="aar-chips">
              <span className="student-visually-hidden" id="aar-chips-label">
                Active filters
              </span>
              <ul className="aar-chips__list" aria-labelledby="aar-chips-label">
                {chips.map((chip) => (
                  <li key={chip.key}>
                    <button
                      type="button"
                      className="aar-chip"
                      aria-label={`Remove filter: ${chip.label}`}
                      onClick={() => apply(chip.remove)}
                    >
                      {chip.label}
                      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                        <path d="M6 6l8 8M14 6l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="aar-link aar-chips__clear" onClick={clearFilters}>
                Clear all
              </button>
            </div>
          )}
        </div>

        {rangeError && !drawerOpen && (
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
            <p className="req-state__body">{list.filterError ?? 'Check your connection and try again.'}</p>
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
                <p className="req-state__body">Try another search term, type, status, term or date range.</p>
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

            <WindowedPager
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

        <FilterDrawer
          open={drawerOpen}
          onClose={closeDrawer}
          titleId="aar-drawer-title"
          title="Advanced filters"
          returnFocusRef={moreButtonRef}
          footer={
            <>
              <button
                type="button"
                className="req-button aar-drawer__reset"
                onClick={() => apply(ADVANCED_FILTERS_RESET)}
                disabled={advancedCount === 0}
              >
                Reset advanced filters
              </button>
              <button type="button" className="aar-drawer__done" onClick={closeDrawer}>
                Done
              </button>
            </>
          }
        >
          <div className="aar-field aar-field--term">
            <label htmlFor="aar-term">Academic term</label>
            <select
              id="aar-term"
              data-autofocus
              value={filters.term ?? ''}
              onChange={(event) => apply({ term: validTerm(event.target.value) })}
            >
              <option value="">All terms</option>
              {terms.map((term) => (
                <option key={term.value} value={term.value}>
                  {term.label}
                </option>
              ))}
            </select>
            {filterOptions.status === 'error' && (
              <button type="button" className="aar-link" onClick={filterOptions.retry}>
                Term options couldn’t load. Try again
              </button>
            )}
          </div>

          <div className="aar-drawer__section">
            <h3 className="aar-drawer__subtitle">Submission date and time</h3>

            <fieldset className="aar-group">
              <legend>From</legend>
              <div className="aar-field">
                <label htmlFor="aar-from">Date</label>
                <input
                  id="aar-from"
                  type="date"
                  value={filters.from ?? ''}
                  max={filters.to ?? undefined}
                  onChange={(event) => apply({ from: event.target.value || null })}
                />
              </div>
              <TimeField
                id="aar-from-time"
                label="Time"
                value={filters.fromTime}
                disabled={!filters.from}
                onChange={(time) => apply({ fromTime: time })}
              />
            </fieldset>

            <fieldset className="aar-group">
              <legend>To</legend>
              <div className="aar-field">
                <label htmlFor="aar-to">Date</label>
                <input
                  id="aar-to"
                  type="date"
                  value={filters.to ?? ''}
                  min={filters.from ?? undefined}
                  onChange={(event) => apply({ to: event.target.value || null })}
                />
              </div>
              <TimeField
                id="aar-to-time"
                label="Time"
                value={filters.toTime}
                disabled={!filters.to}
                onChange={(time) => apply({ toTime: time })}
              />
            </fieldset>

            {rangeError && (
              <p className="aar-error" role="alert">
                {rangeError}
              </p>
            )}
          </div>
        </FilterDrawer>
      </div>
    </StudentLayout>
  )
}

export default AdminAllRequests

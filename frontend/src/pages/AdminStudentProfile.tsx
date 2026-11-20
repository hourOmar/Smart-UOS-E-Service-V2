import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import useStaffIdentity from '../hooks/useStaffIdentity'
import useAdminStudentProfile from '../hooks/useAdminStudentProfile'
import { REQUEST_TYPE_NAMES } from '../services/adminRequests'
import type { AdminStudent, AdminStudentProfile as Profile, RequestHistoryData } from '../services/adminStudentProfile'
import { formatDate } from '../services/studentRequests'
import {
  filterRequestHistory,
  historyStatusLabel,
  historyStatusOptions,
  sortRequestHistory,
  summarizeRequests,
  type HistoryRequest,
} from '../utils/studentProfile'
import { ADMIN_HOME_PATH, ADMIN_MENU_ITEMS, reviewPathFor, type FromStudentProfile } from '../utils/adminPaths'
import StudentLayout from '../components/student/StudentLayout'
import RequestStatusBadge from '../components/requests/RequestStatusBadge'
import TranscriptTerms from '../components/profile/TranscriptTerms'
import { StudentProfileBreadcrumb } from '../components/admin/ReviewBreadcrumb'
import { NOT_RECORDED } from '../components/review/format'
import '../components/requests/Requests.css'
import './AdminDashboard.css'
import './AdminRaiseCapacityReview.css'
import './AdminStudentProfile.css'

function Field({ label, value }: { label: string; value: ReactNode }) {
  const missing = value === null || value === undefined || value === ''
  return (
    <div className="req-fields__item">
      <dt>{label}</dt>
      <dd className={missing ? 'rv-missing' : undefined}>{missing ? NOT_RECORDED : value}</dd>
    </div>
  )
}

const programText = (s: AdminStudent) =>
  s.programName && s.programId ? `${s.programName} (${s.programId})` : (s.programName ?? s.programId)

// -- A. Student information ----------------------------------------------------

function StudentInformation({ student }: { student: AdminStudent }) {
  return (
    <section className="req-panel rv-panel" aria-labelledby="sp-student-title">
      <h2 id="sp-student-title" className="req-panel__title">
        Student information <span className="rv-live-tag">Current record</span>
      </h2>
      <div className="req-panel__body">
        <dl className="req-fields">
          <Field label="Full name" value={student.name} />
          <Field label="Student ID" value={<span className="adm-mono">{student.id}</span>} />
          <Field label="University email" value={student.email} />
          <Field label="College" value={student.college} />
          <Field label="Program" value={programText(student)} />
          <Field label="CGPA" value={student.cgpa == null ? null : student.cgpa.toFixed(2)} />
          <Field label="Completed credit hours" value={student.completedHours == null ? null : String(student.completedHours)} />
          <Field
            label="Expected graduation term"
            value={student.expectedGraduationTerm == null ? null : String(student.expectedGraduationTerm)}
          />
        </dl>
      </div>
    </section>
  )
}

// -- B. Academic transcript ----------------------------------------------------

function PartError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="rv-alert" data-tone="failure" role="alert">
      <p className="rv-alert__title">The {what} could not be loaded.</p>
      <p className="rv-alert__body">Check your connection and try again.</p>
      <button type="button" className="req-button" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}

function Transcript({
  student,
  part,
  onRetry,
}: {
  student: AdminStudent
  part: Profile['transcript']
  onRetry: () => void
}) {
  return (
    <section className="req-panel rv-panel" aria-labelledby="sp-transcript-title">
      <h2 id="sp-transcript-title" className="req-panel__title">
        Academic transcript
      </h2>
      <div className="req-panel__body">
        <div className="sp-summary">
          <dl className="sp-summary__list" aria-label="Academic summary">
            <div className="sp-summary__item">
              <dt>CGPA</dt>
              <dd className={student.cgpa == null ? 'rv-missing' : undefined}>
                {student.cgpa == null ? NOT_RECORDED : student.cgpa.toFixed(2)}
              </dd>
            </div>
            <div className="sp-summary__item">
              <dt>Completed credit hours</dt>
              <dd className={student.completedHours == null ? 'rv-missing' : undefined}>
                {student.completedHours == null ? NOT_RECORDED : student.completedHours}
              </dd>
            </div>
          </dl>
          <p className="sp-summary__note">As recorded on the student record.</p>
        </div>

        {part.status === 'error' && <PartError what="transcript" onRetry={onRetry} />}
        {part.status === 'ready' && (
          <TranscriptTerms entries={part.data} emptyMessage="No courses are recorded for this student." />
        )}
      </div>
    </section>
  )
}

// -- C. Request summary ----------------------------------------------------------

function RequestSummary({ data }: { data: RequestHistoryData }) {
  const s = summarizeRequests(data.rows)
  const cards = [
    { label: 'Total Requests', value: s.total, tone: 'total' },
    { label: 'In Progress', value: s.inProgress, tone: 'progress' },
    { label: 'Approved', value: s.approved, tone: 'approved' },
    { label: 'Rejected', value: s.rejected, tone: 'rejected' },
  ]
  return (
    <section aria-labelledby="sp-summary-title" className="sp-stats-wrap">
      <h2 id="sp-summary-title" className="student-visually-hidden">
        Request summary
      </h2>
      <div className="sp-stats">
        {cards.map((card) => (
          <div key={card.label} className="sp-stat" data-tone={card.tone}>
            <span className="sp-stat__value">{card.value}</span>
            <span className="sp-stat__label">{card.label}</span>
          </div>
        ))}
      </div>
      {s.completedUnconfirmed > 0 && (
        <p className="sp-stats__note">
          {s.completedUnconfirmed} Completed {s.completedUnconfirmed === 1 ? 'request has' : 'requests have'} no
          recorded approval decision, so {s.completedUnconfirmed === 1 ? 'it is' : 'they are'} counted in the total
          only.
        </p>
      )}
      {!data.approvalsKnown && (
        <p className="sp-stats__note" role="status">
          Approval decision records couldn’t be loaded; Completed requests are shown as stored.
        </p>
      )}
    </section>
  )
}

// -- D. Request history -------------------------------------------------------------

function ViewDetails({ row, studentId }: { row: HistoryRequest; studentId: string }) {
  const path = reviewPathFor(row.type, row.id)
  if (path) {
    const state: FromStudentProfile = { from: 'student-profile', studentId }
    return (
      <Link to={path} state={state} className="adm-review">
        View details
        <span className="student-visually-hidden"> of request {row.id}</span>
      </Link>
    )
  }
  return (
    <button type="button" className="adm-review" disabled title={`${row.type} requests don’t have a review page yet.`}>
      View details
      <span className="student-visually-hidden"> of request {row.id}, not yet available</span>
    </button>
  )
}

function FinalDecision({ row }: { row: HistoryRequest }) {
  if (row.status === 'In Progress') return <span className="rv-missing">Pending</span>
  return (
    <span>
      {historyStatusLabel(row)}
      {row.decidedAt && <span className="sp-decided"> · {formatDate(row.decidedAt)}</span>}
    </span>
  )
}

function RequestHistory({ data, studentId }: { data: RequestHistoryData; studentId: string }) {
  const [type, setType] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // Newest first, always; filters keep this order.
  const sorted = useMemo(() => sortRequestHistory(data.rows), [data.rows])
  const shown = filterRequestHistory(sorted, { type, status, query })
  const typeOptions = useMemo(() => {
    const extra = [...new Set(data.rows.map((r) => r.type))].filter((t) => !REQUEST_TYPE_NAMES.includes(t)).sort()
    return [...REQUEST_TYPE_NAMES, ...extra]
  }, [data.rows])
  const statusOptions = useMemo(() => historyStatusOptions(data.rows), [data.rows])
  const filtered = type !== null || status !== null || query.trim() !== ''
  const total = data.rows.length

  return (
    <section className="req-panel rv-panel" aria-labelledby="sp-history-title">
      <h2 id="sp-history-title" className="req-panel__title">
        Request history
      </h2>
      <div className="req-panel__body">
        <div className="sp-filters">
          <label className="sp-filter">
            <span>Request type</span>
            <select value={type ?? ''} onChange={(event) => setType(event.target.value || null)}>
              <option value="">All types</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="sp-filter">
            <span>Status</span>
            <select value={status ?? ''} onChange={(event) => setStatus(event.target.value || null)}>
              <option value="">All statuses</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="sp-filter sp-filter--search">
            <span>Request ID</span>
            <input
              type="search"
              autoComplete="off"
              placeholder="Search request ID"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        <p className="sp-count" aria-live="polite">
          {filtered
            ? `Showing ${shown.length} of ${total} ${total === 1 ? 'request' : 'requests'}, newest first`
            : `${total} ${total === 1 ? 'request' : 'requests'}, newest first`}
        </p>

        {total === 0 ? (
          <p className="rv-muted">This student has not submitted any requests.</p>
        ) : shown.length === 0 ? (
          <p className="rv-muted">No requests match these filters.</p>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table sp-table">
              <thead>
                <tr>
                  <th scope="col">Request ID</th>
                  <th scope="col">Request type</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Status</th>
                  <th scope="col">Final decision</th>
                  <th scope="col" className="adm-table__review">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id}>
                    <td className="adm-table__id">{row.id}</td>
                    <td>{row.type}</td>
                    <td className="adm-table__date">
                      {row.date ? formatDate(row.date) : '—'}
                      {row.time && <span className="sp-time"> {row.time.slice(0, 5)}</span>}
                    </td>
                    <td>
                      <RequestStatusBadge status={row.status} requestType={row.type} approvalRecorded={row.approvalRecorded} />
                    </td>
                    <td>
                      <FinalDecision row={row} />
                    </td>
                    <td className="adm-table__review">
                      <ViewDetails row={row} studentId={studentId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

// -- Page ---------------------------------------------------------------------------

function ProfileBody({ profile, onRetry }: { profile: Profile; onRetry: () => void }) {
  const { student, transcript, requests } = profile
  const program = programText(student)
  return (
    <>
      <div className="rv-head">
        <span className="rv-head__kicker">Student profile</span>
        <h1 className="rv-head__title">{student.name ?? 'Name not recorded'}</h1>
        <p className="rv-head__summary">
          <span className="adm-mono">{student.id}</span>
          {program ? ` · ${program}` : ''}
        </p>
      </div>

      <StudentInformation student={student} />
      <Transcript student={student} part={transcript} onRetry={onRetry} />

      {requests.status === 'error' ? (
        <section className="req-panel rv-panel" aria-labelledby="sp-history-title">
          <h2 id="sp-history-title" className="req-panel__title">
            Request history
          </h2>
          <div className="req-panel__body">
            <PartError what="request history" onRetry={onRetry} />
          </div>
        </section>
      ) : (
        <>
          <RequestSummary data={requests.data} />
          <RequestHistory data={requests.data} studentId={student.id} />
        </>
      )}
    </>
  )
}

// Staff view of one student: record, transcript and every request, from the
// database with the staff member's session. Read-only; requests are reviewed
// and decided on their existing review pages.
function AdminStudentProfile() {
  const { studentId } = useParams()
  const identity = useStaffIdentity()
  const { status, profile, retry } = useAdminStudentProfile(studentId)

  return (
    <StudentLayout profile={identity} solidHeader homePath={ADMIN_HOME_PATH} menuItems={ADMIN_MENU_ITEMS}>
      <div className="adm-page rv-page sp-page">
        <StudentProfileBreadcrumb />

        {status === 'loading' && (
          <div className="req-state" role="status">
            <p className="req-state__body">Loading the student profile…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="req-state" role="alert">
            <h1 className="req-state__title">We couldn’t load this student.</h1>
            <p className="req-state__body">Check your connection and try again.</p>
            <button type="button" className="req-button" onClick={retry}>
              Try again
            </button>
          </div>
        )}

        {status === 'not-found' && (
          <div className="req-state">
            <span className="req-state__icon" aria-hidden="true">
              ○
            </span>
            <h1 className="req-state__title">Student not found</h1>
            <p className="req-state__body">No student has the ID {studentId ?? ''}.</p>
            <Link to={ADMIN_HOME_PATH} className="req-view">
              Back to Admin Dashboard
            </Link>
          </div>
        )}

        {status === 'ready' && profile && <ProfileBody profile={profile} onRetry={retry} />}
      </div>
    </StudentLayout>
  )
}

export default AdminStudentProfile

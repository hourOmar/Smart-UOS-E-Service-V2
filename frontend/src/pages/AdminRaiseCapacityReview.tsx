import type { ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import useStaffIdentity from '../hooks/useStaffIdentity'
import useReviewRecord from '../hooks/useReviewRecord'
import useEligibilityEvaluation from '../hooks/useEligibilityEvaluation'
import useCourseNames from '../hooks/useCourseNames'
import { formatDate } from '../services/studentRequests'
import type { ReviewRecord } from '../services/raiseCapacityReview'
import { ADMIN_HOME_ITEM, ADMIN_HOME_PATH, adminTypePath, type ReviewOrigin } from '../utils/adminPaths'
import StudentLayout from '../components/student/StudentLayout'
import RequestStatusBadge from '../components/requests/RequestStatusBadge'
import EligibilityPanel from '../components/review/EligibilityPanel'
import EvidencePanel from '../components/review/EvidencePanel'
import DecisionPanel from '../components/review/DecisionPanel'
import { NOT_RECORDED } from '../components/review/format'
import '../components/requests/Requests.css'
import './AdminDashboard.css'
import './AdminRaiseCapacityReview.css'

function Field({ label, value, wide = false }: { label: string; value: ReactNode; wide?: boolean }) {
  const missing = value === null || value === undefined || value === ''
  return (
    <div className={`req-fields__item${wide ? ' req-fields__item--wide' : ''}`}>
      <dt>{label}</dt>
      <dd className={missing ? 'rv-missing' : undefined}>{missing ? NOT_RECORDED : value}</dd>
    </div>
  )
}

function RequestPanel({ record }: { record: ReviewRecord }) {
  const { request } = record
  const d = request.details
  return (
    <section className="req-panel rv-panel" aria-labelledby="rv-request-title">
      <h2 id="rv-request-title" className="req-panel__title">
        Request information
      </h2>
      <div className="req-panel__body">
        {!d && (
          <p className="rv-notice" role="alert">
            This request has no Raise Capacity details (course, section, term and justification are
            missing), so it cannot be evaluated.
          </p>
        )}
        <dl className="req-fields">
          <Field label="Request ID" value={<span className="adm-mono">{request.id}</span>} />
          <Field label="Status" value={<RequestStatusBadge status={request.status} requestType={request.type} />} />
          <Field
            label="Submitted"
            value={request.date ? `${formatDate(request.date)}${request.time ? `, ${request.time.slice(0, 5)}` : ''}` : null}
          />
          <Field label="Course" value={d ? [d.courseId, d.courseName].filter(Boolean).join(' ') : null} />
          <Field label="Section" value={d?.sectionId} />
          <Field label="Term" value={d ? String(d.term) : null} />
          <Field label="Summary" value={request.summary} wide />
        </dl>
        <div className="req-text">
          <span className="req-text__label">Student justification</span>
          {d?.justification ? (
            <p className="req-text__body">{d.justification}</p>
          ) : (
            <p className="rv-missing">{NOT_RECORDED}</p>
          )}
        </div>
      </div>
    </section>
  )
}

function StudentPanel({ record }: { record: ReviewRecord }) {
  const s = record.student
  return (
    <section className="req-panel rv-panel" aria-labelledby="rv-student-title">
      <h2 id="rv-student-title" className="req-panel__title">
        Student information <span className="rv-live-tag">Current record</span>
      </h2>
      <div className="req-panel__body">
        {s ? (
          <dl className="req-fields">
            <Field label="Name" value={s.name} />
            <Field label="Student ID" value={<span className="adm-mono">{s.id}</span>} />
            <Field label="Email" value={s.email} />
            <Field label="Program" value={s.program} />
            <Field label="College" value={s.college} />
            <Field label="CGPA" value={s.cgpa == null ? null : s.cgpa.toFixed(2)} />
            <Field label="Completed credit hours" value={s.completedHours == null ? null : String(s.completedHours)} />
            <Field
              label="Expected graduation term"
              value={s.expectedGraduationTerm == null ? null : String(s.expectedGraduationTerm)}
            />
          </dl>
        ) : (
          <p className="rv-notice" role="alert">
            The student record ({record.request.studentId}) could not be found.
          </p>
        )}
      </div>
    </section>
  )
}

// Staff review of one Raise Capacity request: request and student details
// (read directly, so they show even if the eligibility service fails), the
// advisory eligibility recommendation and its evidence snapshot (backend), and
// the staff decision (database function, signed-in staff session).
function AdminRaiseCapacityReview() {
  const { requestId } = useParams()
  const location = useLocation()
  const identity = useStaffIdentity()
  const record = useReviewRecord(requestId)
  // Automatic first evaluation only for In Progress requests; while the
  // request is still loading (or could not be loaded) nothing runs.
  const recordFound = record.status === 'ready' && record.result?.kind === 'found' ? record.result.record : null
  const autoRun = recordFound ? recordFound.request.status === 'In Progress' : null
  const evaluation = useEligibilityEvaluation(requestId, autoRun)

  const origin = (location.state as { from?: ReviewOrigin } | null)?.from
  const back =
    origin === 'dashboard'
      ? { to: ADMIN_HOME_PATH, label: 'Admin home' }
      : { to: adminTypePath('raise-capacity'), label: 'Raise Capacity requests' }

  const found = record.status === 'ready' && record.result?.kind === 'found' ? record.result.record : null
  const shownRun = evaluation.data?.current ?? null
  const groupIds = (shownRun?.evidence?.checks.prerequisite.required_prerequisite_groups ?? []).flat().map(String)
  const names = useCourseNames(groupIds)

  return (
    <StudentLayout profile={identity} solidHeader homePath={ADMIN_HOME_PATH} menuItems={[ADMIN_HOME_ITEM]}>
      <div className="adm-page rv-page">
        <Link to={back.to} className="req-page__back">
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
          {back.label}
        </Link>

        {record.status === 'ready' && record.result?.kind === 'not-found' && (
          <div className="req-state">
            <span className="req-state__icon" aria-hidden="true">○</span>
            <h1 className="req-state__title">Request not found</h1>
            <p className="req-state__body">There is no request with the ID {requestId}.</p>
            <Link to={back.to} className="req-view">Back to {back.label}</Link>
          </div>
        )}

        {record.status === 'ready' && record.result?.kind === 'other-type' && (
          <div className="req-state">
            <span className="req-state__icon" aria-hidden="true">○</span>
            <h1 className="req-state__title">Not a Raise Capacity request</h1>
            <p className="req-state__body">
              {requestId} is a {record.result.type} request. Review is available for Raise Capacity
              requests only.
            </p>
            <Link to={back.to} className="req-view">Back to {back.label}</Link>
          </div>
        )}

        {(record.status !== 'ready' || found) && (
          <>
            <div className="rv-head">
              <span className="rv-head__kicker">Raise Capacity review</span>
              <h1 className="rv-head__title adm-mono">{requestId}</h1>
              {found?.request.details && (
                <p className="rv-head__summary">
                  {[found.request.details.courseId, found.request.details.courseName].filter(Boolean).join(' ')} ·
                  Section {found.request.details.sectionId} · {found.request.details.term}
                  {found.student?.name ? ` · ${found.student.name}` : ''}
                </p>
              )}
            </div>

            {record.status === 'loading' && (
              <div className="req-state" role="status">
                <p className="req-state__body">Loading request and student details…</p>
              </div>
            )}
            {record.status === 'error' && (
              <div className="req-state" role="alert">
                <h2 className="req-state__title">We couldn’t load the request and student details.</h2>
                <p className="req-state__body">Check your connection and try again.</p>
                <button type="button" className="req-button" onClick={record.retry}>
                  Try again
                </button>
              </div>
            )}

            {found && (
              <div className="rv-grid">
                <RequestPanel record={found} />
                <StudentPanel record={found} />
              </div>
            )}

            <EligibilityPanel
              status={evaluation.status}
              data={evaluation.data}
              error={evaluation.error}
              running={evaluation.running}
              notice={evaluation.notice}
              onRerun={evaluation.rerun}
              onRetry={evaluation.retry}
              finalized={autoRun === false}
            />

            {found && (
              <EvidencePanel
                run={shownRun}
                requestedCourseId={found.request.details?.courseId ?? null}
                transcript={found.transcript}
                courseNames={names}
              />
            )}

            {found && <DecisionPanel key={found.request.id} record={found} onChanged={record.refresh} />}
          </>
        )}
      </div>
    </StudentLayout>
  )
}

export default AdminRaiseCapacityReview

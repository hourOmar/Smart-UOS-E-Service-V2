import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import useStaffIdentity from '../hooks/useStaffIdentity'
import useProgramChangeRecord from '../hooks/useProgramChangeRecord'
import useProgramChangeEvaluation from '../hooks/useProgramChangeEvaluation'
import { formatDate } from '../services/studentRequests'
import { programLabel, type ProgramChangeReviewRecord } from '../services/programChangeReview'
import { ADMIN_HOME_ITEM, ADMIN_HOME_PATH, adminTypePath, type ReviewOrigin } from '../utils/adminPaths'
import StudentLayout from '../components/student/StudentLayout'
import RequestStatusBadge from '../components/requests/RequestStatusBadge'
import EvaluationPanel from '../components/programChangeReview/EvaluationPanel'
import DecisionPanel from '../components/programChangeReview/DecisionPanel'
import type { EvaluationSummary } from '../utils/programChangeDecision'
import { NOT_RECORDED } from '../components/review/format'
import '../components/requests/Requests.css'
import './AdminDashboard.css'
import './AdminRaiseCapacityReview.css'
import './AdminProgramChangeReview.css'

function Field({ label, value }: { label: string; value: ReactNode }) {
  const missing = value === null || value === undefined || value === ''
  return (
    <div className="req-fields__item">
      <dt>{label}</dt>
      <dd className={missing ? 'rv-missing' : undefined}>{missing ? NOT_RECORDED : value}</dd>
    </div>
  )
}

function submittedAt(record: ProgramChangeReviewRecord) {
  const { date, time } = record.request
  return date ? `${formatDate(date)}${time ? `, ${time.slice(0, 5)}` : ''}` : null
}

function StudentPanel({ record }: { record: ProgramChangeReviewRecord }) {
  const s = record.student
  return (
    <section className="req-panel rv-panel" aria-labelledby="pcr-student-title">
      <h2 id="pcr-student-title" className="req-panel__title">
        Student information
      </h2>
      <div className="req-panel__body">
        {s ? (
          <dl className="req-fields">
            <Field label="Name" value={s.name} />
            <Field label="Student ID" value={<span className="adm-mono">{s.id}</span>} />
            <Field label="Program" value={s.program} />
            <Field label="College" value={s.college} />
            <Field label="CGPA" value={s.cgpa == null ? null : s.cgpa.toFixed(2)} />
            <Field label="Completed credit hours" value={s.completedHours == null ? null : String(s.completedHours)} />
            <Field
              label="Expected graduation term"
              value={s.expectedGraduationTerm == null ? null : String(s.expectedGraduationTerm)}
            />
            <Field label="Email" value={s.email} />
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

function RequestPanel({ record }: { record: ProgramChangeReviewRecord }) {
  const { request } = record
  const d = request.details
  return (
    <section className="req-panel rv-panel" aria-labelledby="pcr-request-title">
      <h2 id="pcr-request-title" className="req-panel__title">
        Request information
      </h2>
      <div className="req-panel__body">
        {!d && (
          <p className="rv-notice" role="alert">
            This request has no Program Change details (current program, requested program and reason are
            missing), so it cannot be evaluated.
          </p>
        )}
        <dl className="req-fields">
          <Field label="Request ID" value={<span className="adm-mono">{request.id}</span>} />
          <Field label="Current program" value={programLabel(d?.currentProgram)} />
          <Field label="Requested program" value={programLabel(d?.newProgram)} />
          <Field label="Submitted" value={submittedAt(record)} />
        </dl>
        <div className="req-text">
          <span className="req-text__label">Student’s reason</span>
          {d?.reason ? <p className="req-text__body">{d.reason}</p> : <p className="rv-missing">{NOT_RECORDED}</p>}
        </div>
      </div>
    </section>
  )
}

// Staff review of one Program Change request, in the approved layout:
// 1. student and request information (read directly, so they show even if
//    the evaluation service fails); 2. the Program Change Eligibility Agent's
//    advisory evaluation (backend); 3. the administrator's final decision
//    (database function, signed-in staff session).
function AdminProgramChangeReview() {
  const { requestId } = useParams()
  const location = useLocation()
  const identity = useStaffIdentity()
  const record = useProgramChangeRecord(requestId)
  const evaluation = useProgramChangeEvaluation(requestId)

  const origin = (location.state as { from?: ReviewOrigin } | null)?.from
  const back =
    origin === 'dashboard'
      ? { to: ADMIN_HOME_PATH, label: 'Admin home' }
      : { to: adminTypePath('program-change'), label: 'Program Change requests' }

  const found = record.status === 'ready' && record.result?.kind === 'found' ? record.result.record : null
  const newProgram = found?.request.details?.newProgram
  const newProgramName = newProgram?.name ?? newProgram?.id ?? null
  const submitted = found ? submittedAt(found) : null

  const evalData = evaluation.data
  const latest = evalData?.latest_attempt ?? null
  const evaluationSummary: EvaluationSummary = {
    loading: evaluation.status === 'loading',
    hasCompleted: Boolean(evalData?.current),
    latestFailed: latest?.run_status === 'failed' || latest?.run_status === 'interrupted',
    running: evaluation.running || Boolean(evalData?.in_progress),
    unavailable: evaluation.status === 'error' && !evalData,
  }
  const { refresh: refreshRecord } = record
  const { refresh: refreshEvaluation } = evaluation
  const afterDecision = useCallback(() => {
    refreshRecord()
    refreshEvaluation()
  }, [refreshRecord, refreshEvaluation])

  return (
    <StudentLayout profile={identity} solidHeader homePath={ADMIN_HOME_PATH} menuItems={[ADMIN_HOME_ITEM]}>
      <div className="adm-page rv-page pcr-page">
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
            <h1 className="req-state__title">Not a Program Change request</h1>
            <p className="req-state__body">
              {requestId} is a {record.result.type} request. This page reviews Program Change requests only.
            </p>
            <Link to={back.to} className="req-view">Back to {back.label}</Link>
          </div>
        )}

        {(record.status !== 'ready' || found) && (
          <>
            <div className="pcr-head">
              <div className="pcr-head__meta">
                <span className="adm-mono pcr-head__id">{requestId}</span>
                {found && <RequestStatusBadge status={found.request.status} requestType={found.request.type} />}
              </div>
              <h1 className="pcr-head__title">Program Change{newProgramName ? ` · ${newProgramName}` : ''}</h1>
              {found && (submitted || found.student?.name) && (
                <p className="pcr-head__sub">
                  {submitted ? `Submitted ${submitted}` : 'Submitted'}
                  {found.student?.name ? ` by ${found.student.name}` : ''}
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
              <div className="pcr-row">
                <StudentPanel record={found} />
                <RequestPanel record={found} />
              </div>
            )}

            <EvaluationPanel
              status={evaluation.status}
              data={evaluation.data}
              error={evaluation.error}
              running={evaluation.running}
              notice={evaluation.notice}
              onRun={evaluation.run}
              onRetry={evaluation.retry}
              requestStatus={found?.request.status ?? null}
            />

            {found && (
              <DecisionPanel
                key={found.request.id}
                record={found}
                recommendation={evalData?.current?.recommendation ?? null}
                evaluation={evaluationSummary}
                onChanged={afterDecision}
              />
            )}
          </>
        )}
      </div>
    </StudentLayout>
  )
}

export default AdminProgramChangeReview

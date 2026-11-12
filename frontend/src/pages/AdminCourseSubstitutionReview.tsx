import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import useStaffIdentity from '../hooks/useStaffIdentity'
import useCourseSubstitutionRecord from '../hooks/useCourseSubstitutionRecord'
import useCourseSubstitutionEvaluation from '../hooks/useCourseSubstitutionEvaluation'
import { formatDate } from '../services/studentRequests'
import { ADMIN_HOME_ITEM, ADMIN_HOME_PATH, adminTypePath, type ReviewOrigin } from '../utils/adminPaths'
import { EXPLANATION_FIELD_ID, type CourseSubstitutionEvaluationSummary } from '../utils/courseSubstitutionDecision'
import {
  courseTitle,
  distinctDescription,
  type CourseRef,
  type CourseSubstitutionReviewRecord,
} from '../utils/courseSubstitutionRecord'
import { statusLabel } from '../utils/statusLabels'
import StudentLayout from '../components/student/StudentLayout'
import RequestStatusBadge from '../components/requests/RequestStatusBadge'
import EvaluationPanel from '../components/courseSubstitutionReview/EvaluationPanel'
import DecisionPanel from '../components/courseSubstitutionReview/DecisionPanel'
import { NOT_RECORDED, formatDateTime } from '../components/review/format'
import '../components/requests/Requests.css'
import './AdminDashboard.css'
import './AdminRaiseCapacityReview.css'
import './AdminProgramChangeReview.css'
import './AdminIncompleteExamReview.css'
import './AdminCourseSubstitutionReview.css'

function Field({ label, value }: { label: string; value: ReactNode }) {
  const missing = value === null || value === undefined || value === ''
  return (
    <div className="req-fields__item">
      <dt>{label}</dt>
      <dd className={missing ? 'rv-missing' : undefined}>{missing ? NOT_RECORDED : value}</dd>
    </div>
  )
}

function submittedAt(record: CourseSubstitutionReviewRecord) {
  const { date, time } = record.request
  return date ? `${formatDate(date)}${time ? `, ${time.slice(0, 5)}` : ''}` : null
}

/** 'Completed' reads "Approved" only with a matching approval decision record. */
function approvalRecorded(record: CourseSubstitutionReviewRecord) {
  return record.decision?.choice === 'approve'
}

function courseWithHours(ref: CourseRef | undefined) {
  const title = courseTitle(ref)
  if (!title) return null
  return ref?.creditHours == null ? title : `${title} · ${ref.creditHours} credit hours`
}

function StudentPanel({ record }: { record: CourseSubstitutionReviewRecord }) {
  const s = record.student
  return (
    <section className="req-panel rv-panel" aria-labelledby="csr-student-title">
      <h2 id="csr-student-title" className="req-panel__title">
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

function RequestPanel({ record }: { record: CourseSubstitutionReviewRecord }) {
  const { request } = record
  const d = request.details
  // Shown once when the description only repeats the stated reason.
  const description = distinctDescription(d?.reason, request.summary)
  return (
    <section className="req-panel rv-panel" aria-labelledby="csr-request-title">
      <h2 id="csr-request-title" className="req-panel__title">
        Requested substitution
      </h2>
      <div className="req-panel__body">
        {!d && (
          <p className="rv-notice" role="alert">
            This request has no Course Substitution details (the original and proposed course are missing), so it cannot
            be evaluated or decided here.
          </p>
        )}
        <dl className="req-fields">
          <Field label="Request ID" value={<span className="adm-mono">{request.id}</span>} />
          <Field label="Original course" value={courseWithHours(d?.original)} />
          <Field label="Proposed course" value={courseWithHours(d?.proposed)} />
          <Field label="Submitted" value={submittedAt(record)} />
        </dl>
        <div className="req-text">
          <span className="req-text__label">Stated reason</span>
          {d?.reason ? <p className="req-text__body">{d.reason}</p> : <p className="rv-missing">{NOT_RECORDED}</p>}
        </div>
        {description && (
          <div className="req-text">
            <span className="req-text__label">Student’s description</span>
            <p className="req-text__body">{description}</p>
          </div>
        )}
      </div>
    </section>
  )
}

function HistoryPanel({
  record,
  runCount,
  lastEvaluated,
}: {
  record: CourseSubstitutionReviewRecord
  runCount: number | null
  lastEvaluated: string | null
}) {
  const { request, decision, history } = record
  const staff = (id: number | null) => (id == null ? null : `Staff ID ${id}`)
  const finalized = history
    ? [statusLabel(history.status, request.type, approvalRecorded(record)), formatDateTime(history.date), staff(history.staffId)]
        .filter(Boolean)
        .join(' · ')
    : null
  return (
    <section className="req-panel rv-panel" aria-labelledby="csr-history-title">
      <h2 id="csr-history-title" className="req-panel__title">
        Request history
      </h2>
      <div className="req-panel__body">
        <dl className="req-fields">
          <Field label="Submitted" value={submittedAt(record)} />
          <Field
            label="Current status"
            value={
              <RequestStatusBadge
                status={request.status}
                requestType={request.type}
                approvalRecorded={approvalRecorded(record)}
              />
            }
          />
          <Field label="AI evaluations stored" value={runCount == null ? null : String(runCount)} />
          <Field label="Last evaluated" value={lastEvaluated} />
          <Field label="Finalized" value={finalized ?? (request.status === 'In Progress' ? 'Not yet decided' : null)} />
          <Field
            label="Decision recorded"
            value={
              decision
                ? `${decision.choice === 'approve' ? 'Approved' : 'Rejected'}${decision.date ? ` · ${formatDateTime(decision.date)}` : ''}`
                : request.status === 'In Progress'
                  ? 'Not yet decided'
                  : null
            }
          />
        </dl>
      </div>
    </section>
  )
}

function ReviewPage({ requestId }: { requestId: string | undefined }) {
  const location = useLocation()
  const identity = useStaffIdentity()
  const record = useCourseSubstitutionRecord(requestId)
  const evaluation = useCourseSubstitutionEvaluation(requestId)
  // The explanation to the student lives here so a suggested reason
  // ("Use this reason") can fill it; staff can always edit it.
  const [explanation, setExplanation] = useState('')
  const [decisionStep, setDecisionStep] = useState<'form' | 'confirm'>('form')

  const origin = (location.state as { from?: ReviewOrigin } | null)?.from
  const back =
    origin === 'dashboard'
      ? { to: ADMIN_HOME_PATH, label: 'Admin home' }
      : { to: adminTypePath('course-substitution'), label: 'Course Substitution requests' }

  const found = record.status === 'ready' && record.result?.kind === 'found' ? record.result.record : null
  const original = found ? courseTitle(found.request.details?.original) : null
  const submitted = found ? submittedAt(found) : null

  const evalData = evaluation.data
  const latest = evalData?.latest_attempt ?? null
  const evaluationSummary: CourseSubstitutionEvaluationSummary = {
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

  const decidable = Boolean(found && found.request.status === 'In Progress' && found.request.details)
  const applyReason = useCallback((text: string) => {
    setExplanation(text)
    const field = document.getElementById(EXPLANATION_FIELD_ID)
    field?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    field?.focus({ preventScroll: true })
  }, [])

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
            <h1 className="req-state__title">Not a Course Substitution request</h1>
            <p className="req-state__body">
              {requestId} is a {record.result.type} request. This page reviews Course Substitution requests only.
            </p>
            <Link to={back.to} className="req-view">Back to {back.label}</Link>
          </div>
        )}

        {(record.status !== 'ready' || found) && (
          <>
            <div className="pcr-head">
              <div className="pcr-head__meta">
                <span className="adm-mono pcr-head__id">{requestId}</span>
                {found && (
                  <RequestStatusBadge
                    status={found.request.status}
                    requestType={found.request.type}
                    approvalRecorded={approvalRecorded(found)}
                  />
                )}
              </div>
              <h1 className="pcr-head__title">Course Substitution{original ? ` · ${original}` : ''}</h1>
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
              <>
                <div className="pcr-row">
                  <StudentPanel record={found} />
                  <RequestPanel record={found} />
                </div>
                <HistoryPanel
                  record={found}
                  runCount={evalData ? evalData.run_count : null}
                  lastEvaluated={formatDateTime(evalData?.current?.finished_at)}
                />
              </>
            )}

            <EvaluationPanel
              status={evaluation.status}
              data={evaluation.data}
              error={evaluation.error}
              running={evaluation.running}
              notice={evaluation.notice}
              canStartFirst={evaluation.canStartFirst}
              canRerun={evaluation.canRerun}
              onRun={evaluation.run}
              onRetry={evaluation.retry}
              requestStatus={found?.request.status ?? null}
              onUseReason={decidable && decisionStep === 'form' ? applyReason : null}
            />

            {found && (
              <DecisionPanel
                key={found.request.id}
                record={found}
                result={evalData?.current?.overall_result ?? null}
                evaluation={evaluationSummary}
                explanation={explanation}
                onExplanationChange={setExplanation}
                onStepChange={setDecisionStep}
                onChanged={afterDecision}
              />
            )}
          </>
        )}
      </div>
    </StudentLayout>
  )
}

// Staff review of one Course Substitution request, in the Incomplete Exam
// layout: 1. student, requested substitution and history (read directly, so
// they show even if the evaluation service fails); 2. the agent's advisory
// evaluation (backend), which runs only when staff click Run Evaluation or
// Re-evaluate, never on opening; 3. the administrator's final decision
// (database function, signed-in staff session). Keyed by request, so a draft
// explanation never carries over to another request.
function AdminCourseSubstitutionReview() {
  const { requestId } = useParams()
  return <ReviewPage key={requestId} requestId={requestId} />
}

export default AdminCourseSubstitutionReview

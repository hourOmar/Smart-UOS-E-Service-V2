import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import useStaffIdentity from '../hooks/useStaffIdentity'
import useCourseEquivalencyRecord from '../hooks/useCourseEquivalencyRecord'
import useCourseEquivalencyEvaluation from '../hooks/useCourseEquivalencyEvaluation'
import useCourseEquivalencySyllabi from '../hooks/useCourseEquivalencySyllabi'
import { formatDate } from '../services/studentRequests'
import {
  ADMIN_HOME_PATH,
  ADMIN_MENU_ITEMS,
  adminTypePath,
  allRequestsReturnPath,
  studentProfilePath,
  type ReviewOrigin,
} from '../utils/adminPaths'
import { evaluatedFile } from '../utils/courseEquivalencyEvaluation'
import { decisionReadiness } from '../utils/courseEquivalencyDecision'
import { programChangeContext, type CourseEquivalencyReviewRecord } from '../utils/courseEquivalencyRecord'
import { statusLabel } from '../utils/statusLabels'
import StudentLayout from '../components/student/StudentLayout'
import ReviewBreadcrumb from '../components/admin/ReviewBreadcrumb'
import RequestStatusBadge from '../components/requests/RequestStatusBadge'
import EvaluationPanel from '../components/courseEquivalencyReview/EvaluationPanel'
import SyllabusPanel from '../components/courseEquivalencyReview/SyllabusPanel'
import DecisionPanel from '../components/courseEquivalencyReview/DecisionPanel'
import { NOT_RECORDED, formatDateTime } from '../components/review/format'
import '../components/requests/Requests.css'
import './AdminDashboard.css'
import './AdminRaiseCapacityReview.css'
import './AdminProgramChangeReview.css'
import './AdminIncompleteExamReview.css'
import './AdminCourseEquivalencyReview.css'

function Field({ label, value }: { label: string; value: ReactNode }) {
  const missing = value === null || value === undefined || value === ''
  return (
    <div className="req-fields__item">
      <dt>{label}</dt>
      <dd className={missing ? 'rv-missing' : undefined}>{missing ? NOT_RECORDED : value}</dd>
    </div>
  )
}

function submittedAt(record: CourseEquivalencyReviewRecord) {
  const { date, time } = record.request
  return date ? `${formatDate(date)}${time ? `, ${time.slice(0, 5)}` : ''}` : null
}

const courseText = (c: { id: string; name: string | null } | undefined) => (c ? [c.id, c.name].filter(Boolean).join(' ') : null)

function StudentPanel({ record }: { record: CourseEquivalencyReviewRecord }) {
  const s = record.student
  return (
    <section className="req-panel rv-panel" aria-labelledby="cer-student-title">
      <h2 id="cer-student-title" className="req-panel__title">
        Student information
      </h2>
      <div className="req-panel__body">
        {s ? (
          <dl className="req-fields">
            <Field label="Name" value={s.name} />
            <Field
              label="Student ID"
              value={
                <Link to={studentProfilePath(s.id)} className="adm-mono rv-student-link">
                  {s.id}
                  <span className="student-visually-hidden"> (open student profile)</span>
                </Link>
              }
            />
            <Field label="Program (student record)" value={s.program} />
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

function RequestPanel({ record }: { record: CourseEquivalencyReviewRecord }) {
  const d = record.details
  return (
    <section className="req-panel rv-panel" aria-labelledby="cer-request-title">
      <h2 id="cer-request-title" className="req-panel__title">
        Requested equivalency
      </h2>
      <div className="req-panel__body">
        {!d && (
          <p className="rv-notice" role="alert">
            This request has no Course Equivalency details (old and new course are missing), so it cannot be evaluated here.
          </p>
        )}
        <dl className="req-fields">
          <Field label="Request ID" value={<span className="adm-mono">{record.request.id}</span>} />
          <Field label="Completed (old) course" value={courseText(d?.oldCourse)} />
          <Field label="Old course credit hours" value={d?.oldCourse.creditHours == null ? null : String(d.oldCourse.creditHours)} />
          <Field label="Requested (new) course" value={courseText(d?.newCourse)} />
          <Field label="New course credit hours" value={d?.newCourse.creditHours == null ? null : String(d.newCourse.creditHours)} />
          <Field
            label="Grade at submission"
            value={d?.gradeAtSubmission ? `${d.gradeAtSubmission}${d.termAtSubmission ? ` (term ${d.termAtSubmission})` : ''}` : null}
          />
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

function ProgramChangePanel({ record }: { record: CourseEquivalencyReviewRecord }) {
  const d = record.details
  const pc = record.programChange
  return (
    <section className="req-panel rv-panel" aria-labelledby="cer-program-title">
      <h2 id="cer-program-title" className="req-panel__title">
        Program Change context
      </h2>
      <div className="req-panel__body">
        <p className="req-text__body">{programChangeContext(record)}</p>
        {d?.programChangeRequestId && (
          <dl className="req-fields">
            <Field label="Program Change request" value={<span className="adm-mono">{d.programChangeRequestId}</span>} />
            <Field label="From program" value={d.oldProgram?.name ?? pc?.from} />
            <Field label="To program" value={d.newProgram?.name ?? pc?.to} />
            <Field label="Study plan version" value={d.planVersion} />
            <Field label="Program Change status" value={pc?.status ? statusLabel(pc.status, 'Program Change') : null} />
          </dl>
        )}
      </div>
    </section>
  )
}

function HistoryPanel({ record, runCount, lastEvaluated }: { record: CourseEquivalencyReviewRecord; runCount: number | null; lastEvaluated: string | null }) {
  const { request, history } = record
  const finalized = history
    ? [statusLabel(history.status ?? request.status, request.type), formatDateTime(history.date), history.staffId == null ? null : `Staff ID ${history.staffId}`]
        .filter(Boolean)
        .join(' · ')
    : null
  return (
    <section className="req-panel rv-panel" aria-labelledby="cer-history-title">
      <h2 id="cer-history-title" className="req-panel__title">
        Request history
      </h2>
      <div className="req-panel__body">
        <dl className="req-fields">
          <Field label="Submitted" value={submittedAt(record)} />
          <Field label="Current status" value={<RequestStatusBadge status={request.status} requestType={request.type} />} />
          <Field label="AI evaluations stored" value={runCount == null ? null : String(runCount)} />
          <Field label="Last evaluated" value={lastEvaluated} />
          <Field label="Finalized" value={finalized ?? (request.status === 'In Progress' ? 'Not yet decided' : null)} />
        </dl>
      </div>
    </section>
  )
}

function ReviewPage({ requestId }: { requestId: string | undefined }) {
  const location = useLocation()
  const identity = useStaffIdentity()
  const record = useCourseEquivalencyRecord(requestId)
  const evaluation = useCourseEquivalencyEvaluation(requestId)
  const syllabi = useCourseEquivalencySyllabi(requestId, evaluation.refresh)

  const origin = (location.state as { from?: ReviewOrigin } | null)?.from
  const allRequests = allRequestsReturnPath(location.state)
  const back = allRequests
    ? { to: allRequests, label: 'All Requests' }
    : origin === 'dashboard'
      ? { to: ADMIN_HOME_PATH, label: 'Admin home' }
      : { to: adminTypePath('course-equivalency'), label: 'Course Equivalency requests' }

  const found = record.status === 'ready' && record.result?.kind === 'found' ? record.result.record : null
  const d = found?.details
  const title = d ? `${d.oldCourse.id} → ${d.newCourse.id}` : null
  const submitted = found ? submittedAt(found) : null
  const evalData = evaluation.data
  const currentRun = evalData?.current ?? null
  const readiness = decisionReadiness({ status: evaluation.status, data: evalData, running: evaluation.running })
  const { refresh: refreshRecord } = record
  const { refresh: refreshEvaluation } = evaluation
  const afterDecision = useCallback(() => {
    refreshRecord()
    refreshEvaluation()
  }, [refreshRecord, refreshEvaluation])

  return (
    <StudentLayout profile={identity} solidHeader homePath={ADMIN_HOME_PATH} menuItems={ADMIN_MENU_ITEMS}>
      <div className="adm-page rv-page pcr-page">
        <ReviewBreadcrumb typeId="course-equivalency" />

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
            <h1 className="req-state__title">Not a Course Equivalency request</h1>
            <p className="req-state__body">
              {requestId} is a {record.result.type} request. This page reviews Course Equivalency requests only.
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
              <h1 className="pcr-head__title">Course Equivalency{title ? ` · ${title}` : ''}</h1>
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
                <p className="req-state__body">Check your connection and try again. If it persists, your account may not have staff access.</p>
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
                <div className="pcr-row">
                  <ProgramChangePanel record={found} />
                  <HistoryPanel
                    record={found}
                    runCount={evalData ? evalData.run_count : null}
                    lastEvaluated={formatDateTime(currentRun?.finished_at)}
                  />
                </div>
                <div className="pcr-row">
                  {(['old', 'new'] as const).map((side) => (
                    <SyllabusPanel
                      key={side}
                      requestId={found.request.id}
                      side={side}
                      status={syllabi.status}
                      data={syllabi.data}
                      error={syllabi.error}
                      upload={syllabi.uploads[side]}
                      onUpload={(s, file) => void syllabi.upload(s, file)}
                      onReload={syllabi.reload}
                      evaluated={evaluatedFile(currentRun, side)}
                    />
                  ))}
                </div>
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
            />

            {found && <DecisionPanel key={found.request.id} record={found} readiness={readiness} onChanged={afterDecision} />}
          </>
        )}
      </div>
    </StudentLayout>
  )
}

// Staff review of one Course Equivalency request:
// 1. student, requested equivalency, Program Change context and history (read directly, so
//    they show even if the backend fails);
// 2. the two syllabi (Phase 3B): download with the staff session, upload / replace;
// 3. the agents' advisory evaluation (backend): the first one starts automatically only when
//    the backend reports it eligible, once; staff can re-evaluate;
// 4. the administrator's final decision (database function, signed-in staff session): only on
//    a completed evaluation of the current syllabi; an override of the agent's recommendation
//    must be confirmed and is recorded. DECISION ONLY: an approval does not change the
//    transcript, credit hours, CGPA, completed hours or program (a later phase).
function AdminCourseEquivalencyReview() {
  const { requestId } = useParams()
  return <ReviewPage key={requestId} requestId={requestId} />
}

export default AdminCourseEquivalencyReview

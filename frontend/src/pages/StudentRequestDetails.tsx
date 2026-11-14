import { Link, useLocation, useParams } from 'react-router-dom'
import useStudentProfile from '../hooks/useStudentProfile'
import useStudentRequestDetails from '../hooks/useStudentRequestDetails'
import { formatDate, type StudentRequestDetails as Details } from '../services/studentRequests'
import {
  MY_REQUESTS_PATH,
  RECENT_REQUESTS_ANCHOR_ID,
  type RequestsOrigin,
} from '../utils/requestPaths'
import StudentLayout from '../components/student/StudentLayout'
import RequestStatusBadge from '../components/requests/RequestStatusBadge'
import StudentProofDocuments from '../components/requests/StudentProofDocuments'
import { CopyRequestId, DetailIcon } from '../components/requests/RequestDetailParts'
import useRejectionReason from '../hooks/useRejectionReason'
import useProgramChangeDecision from '../hooks/useProgramChangeDecision'
import useIncompleteExamDecision from '../hooks/useIncompleteExamDecision'
import useCourseSubstitutionDecision from '../hooks/useCourseSubstitutionDecision'
import { COURSE_SUBSTITUTION, INCOMPLETE_EXAM, PROGRAM_CHANGE, RAISE_CAPACITY, statusLabel } from '../utils/statusLabels'
import '../components/requests/Requests.css'

// Final outcomes use the same wording as the student notifications; a request
// type whose 'Completed' means an approval (statusLabel: Raise Capacity,
// Program Change; Incomplete Exam only with a recorded approval decision)
// reads "approved".
const DECISION_HEADINGS: Record<string, { tone: string; glyph: string; heading: string }> = {
  Completed: { tone: 'completed', glyph: '✓', heading: 'Your request has been completed.' },
  Rejected: { tone: 'rejected', glyph: '✕', heading: 'Your request has been rejected.' },
}

function decisionHeading(request: Details, approvalRecorded: boolean) {
  const heading = DECISION_HEADINGS[request.status]
  if (heading && statusLabel(request.status, request.type, approvalRecorded) === 'Approved') {
    return { ...heading, heading: 'Your request has been approved.' }
  }
  return heading
}

// The administrator's explanation of a decided request, for approvals and
// rejections alike. A loading failure is reported as such, never as a missing
// explanation.
function DecisionExplanation({
  status,
  explanation,
  retry,
  rejected,
}: {
  status: 'loading' | 'ready' | 'error'
  explanation: string | null | undefined
  retry: () => void
  rejected: boolean
}) {
  return (
    <div className={`req-text${rejected ? ' req-rejection' : ''}`}>
      <span className="req-text__label">{rejected ? 'Reason for rejection' : 'Explanation from the administrator'}</span>
      {status === 'loading' && <p className="req-state__body" role="status">Loading the explanation…</p>}
      {status === 'error' && (
        <div role="alert">
          <p className="req-state__body">We couldn’t load the explanation.</p>
          <button type="button" className="req-button" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {status === 'ready' &&
        (explanation ? (
          <p className="req-text__body">{explanation}</p>
        ) : (
          <p className="req-state__body">No explanation recorded.</p>
        ))}
    </div>
  )
}

// A decided Program Change request (get_my_program_change_decision).
function ProgramChangeDecisionText({ requestId, rejected }: { requestId: string; rejected: boolean }) {
  const { status, decision, retry } = useProgramChangeDecision(requestId, true)
  return <DecisionExplanation status={status} explanation={decision?.explanation} retry={retry} rejected={rejected} />
}

// The explanation staff saved when rejecting a Raise Capacity request. A
// loading failure is reported as such, never as a missing explanation.
function RejectionReasonText({ requestId }: { requestId: string }) {
  const { status, reason, retry } = useRejectionReason(requestId, true)
  return (
    <div className="req-text req-rejection">
      <span className="req-text__label">Reason for rejection</span>
      {status === 'loading' && <p className="req-state__body" role="status">Loading the reason…</p>}
      {status === 'error' && (
        <div role="alert">
          <p className="req-state__body">We couldn’t load the reason for rejection.</p>
          <button type="button" className="req-button" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {status === 'ready' &&
        (reason?.explanation ? (
          <p className="req-text__body">{reason.explanation}</p>
        ) : (
          <p className="req-state__body">No explanation recorded.</p>
        ))}
    </div>
  )
}

type StepState = 'done' | 'current' | 'pending' | 'rejected'

// The request's three stages, from its stored status and dates only.
function Progress({ request, approvalRecorded }: { request: Details; approvalRecorded: boolean }) {
  const decided = request.status !== 'In Progress'
  const steps: { title: string; meta: string; state: StepState }[] = [
    { title: 'Request Submitted', meta: formatDate(request.date), state: 'done' },
    {
      title: 'Under Review',
      meta: decided ? 'Review finished' : 'In progress',
      state: decided ? 'done' : 'current',
    },
    decided
      ? {
          title: `Request ${statusLabel(request.status, request.type, approvalRecorded)}`,
          meta: request.decision ? formatDate(request.decision.date) : '',
          state: request.status === 'Rejected' ? 'rejected' : 'done',
        }
      : { title: 'Decision', meta: 'Not yet decided', state: 'pending' },
  ]
  const stateLabel: Record<StepState, string> = {
    done: 'done',
    current: 'current step',
    pending: 'not started',
    rejected: 'rejected',
  }

  return (
    <section className="req-panel req-progress" aria-labelledby="req-progress-title">
      <h2 id="req-progress-title" className="req-panel__title">
        <DetailIcon name="progress" />
        Request Progress
      </h2>
      <ol className="req-progress__list">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="req-progress__step"
            data-state={step.state}
            // The line below a stage takes the colour of the stage it leads to.
            data-next={steps[index + 1]?.state}
          >
            <div className="req-progress__rail">
              <span className="req-progress__dot" aria-hidden="true">
                {step.state === 'done' && <DetailIcon name="check" />}
                {step.state === 'rejected' && <DetailIcon name="cross" />}
                {step.state === 'current' && '◐'}
              </span>
              <span className="req-progress__line" aria-hidden="true" />
            </div>
            <div className="req-progress__text">
              <span className="req-progress__title">
                {step.title}
                <span className="student-visually-hidden"> ({stateLabel[step.state]})</span>
              </span>
              {step.meta && <span className="req-progress__meta">{step.meta}</span>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function RequestBody({ request }: { request: Details }) {
  const showRejectionReason = request.type === RAISE_CAPACITY && request.status === 'Rejected'
  const decided = request.status === 'Completed' || request.status === 'Rejected'
  const showProgramChangeDecision = request.type === PROGRAM_CHANGE && decided
  const showIncompleteExamDecision = request.type === INCOMPLETE_EXAM && decided
  // A decided Incomplete Exam request (get_my_incomplete_exam_decision, which
  // returns only the signed-in student's own decided request). Its 'Completed'
  // reads "Approved" only when an approval decision record exists, never from
  // the status alone.
  const incompleteExam = useIncompleteExamDecision(request.id, showIncompleteExamDecision)
  // A decided Course Substitution request (get_my_course_substitution_decision),
  // under the same recorded-approval rule as Incomplete Exam.
  const showCourseSubstitutionDecision = request.type === COURSE_SUBSTITUTION && decided
  const courseSubstitution = useCourseSubstitutionDecision(request.id, showCourseSubstitutionDecision)
  const courseSubstitutionApproved =
    courseSubstitution.decision?.decision === 'approve' && courseSubstitution.decision.hasDecisionRecord
  const approvalRecorded =
    incompleteExam.decision?.decision === 'approve' && incompleteExam.decision.hasDecisionRecord || courseSubstitutionApproved
  const decision = decisionHeading(request, approvalRecorded)
  // Whether this type has an administrator's explanation to show.
  const hasExplanation =
    showRejectionReason || showProgramChangeDecision || showIncompleteExamDecision || showCourseSubstitutionDecision

  return (
    <>
      <header className="req-hero">
        <h1 className="req-detail__title">{request.type} Request</h1>
        {request.title && <p className="req-hero__subtitle">{request.title}</p>}
        <div className="req-hero__meta">
          <span className="req-hero__id">
            <DetailIcon name="file" />
            <span className="req-detail__id">{request.id}</span>
            <CopyRequestId requestId={request.id} />
          </span>
          <span className="req-hero__divider" aria-hidden="true" />
          <span className="req-hero__date">
            <DetailIcon name="calendar" />
            Submitted {formatDate(request.date)}
          </span>
          <span className="req-hero__status">
            <RequestStatusBadge status={request.status} requestType={request.type} approvalRecorded={approvalRecorded} />
          </span>
        </div>
      </header>

      <div className="req-detail__columns">
        <div className="req-detail__main">
          <section className="req-panel" aria-labelledby="req-submitted-title">
            <h2 id="req-submitted-title" className="req-panel__title">
              <DetailIcon name="details" />
              Request Details
            </h2>
            <div className="req-panel__body">
              <dl className="req-fields">
                {request.summary && (
                  <div className="req-fields__item req-fields__item--wide">
                    <dt>Summary</dt>
                    <dd>{request.summary}</dd>
                  </div>
                )}
                <div className="req-fields__item">
                  <dt>Request type</dt>
                  <dd>{request.type}</dd>
                </div>
                {request.fields.map((field) => (
                  <div key={field.label} className="req-fields__item">
                    <dt>{field.label}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>
              {request.reason && (
                <div className="req-text">
                  <span className="req-text__label">{request.reason.label}</span>
                  <p className="req-text__body">{request.reason.text}</p>
                </div>
              )}
            </div>
          </section>

          {request.type === INCOMPLETE_EXAM && request.documents !== null && (
            <StudentProofDocuments requestId={request.id} paths={request.documents} />
          )}
        </div>

        <Progress request={request} approvalRecorded={approvalRecorded} />
      </div>

      {/* Below both columns: the final decision once the request is decided,
          otherwise a note that none has been made yet. */}
      {decision ? (
        <section
          className="req-decision"
          data-tone={decision.tone}
          data-explained={hasExplanation || undefined}
          aria-labelledby="req-decision-title"
        >
          <span className="req-decision__icon" aria-hidden="true">
            <DetailIcon name={decision.tone === 'rejected' ? 'cross' : 'check'} />
          </span>
          <div className="req-decision__summary">
            <h2 id="req-decision-title" className="req-decision__title">
              Final Decision
            </h2>
            <p className="req-decision__outcome">{decision.heading}</p>
            {request.decision && (
              <p className="req-decision__body">
                Decided on {formatDate(request.decision.date)}
              </p>
            )}
          </div>
          {hasExplanation && (
            <div className="req-decision__explanation">
              {showRejectionReason && <RejectionReasonText requestId={request.id} />}
              {showProgramChangeDecision && (
                <ProgramChangeDecisionText requestId={request.id} rejected={request.status === 'Rejected'} />
              )}
              {showIncompleteExamDecision && (
                <DecisionExplanation
                  status={incompleteExam.status}
                  explanation={incompleteExam.decision?.explanation}
                  retry={incompleteExam.retry}
                  rejected={request.status === 'Rejected'}
                />
              )}
              {showCourseSubstitutionDecision && (
                <DecisionExplanation
                  status={courseSubstitution.status}
                  explanation={courseSubstitution.decision?.explanation}
                  retry={courseSubstitution.retry}
                  rejected={request.status === 'Rejected'}
                />
              )}
            </div>
          )}
        </section>
      ) : (
        <div className="req-awaiting">
          <span className="req-awaiting__glyph" aria-hidden="true">
            ◐
          </span>
          <span>
            <strong>No decision yet.</strong> Your request is being reviewed. The
            decision will appear here.
          </span>
        </div>
      )}
    </>
  )
}

// One of the signed-in student's requests with everything saved for it.
// Opened from My Requests and from Recent Requests on the dashboard.
function StudentRequestDetails() {
  const { requestId } = useParams()
  const location = useLocation()
  const profile = useStudentProfile()
  const { status, request, retry } = useStudentRequestDetails(requestId)

  const origin = (location.state as { from?: RequestsOrigin } | null)?.from
  const back =
    origin === 'dashboard'
      ? { to: '/student', state: { scrollTo: RECENT_REQUESTS_ANCHOR_ID }, label: 'Back to dashboard' }
      : { to: MY_REQUESTS_PATH, state: undefined, label: 'Back to My Requests' }

  return (
    <StudentLayout profile={profile} solidHeader>
      <div className="req-page req-details">
        <Link to={back.to} state={back.state} className="req-page__back">
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

        {status === 'loading' && (
          <div className="req-state" role="status">
            <p className="req-state__body">Loading request details…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="req-state" role="alert">
            <h1 className="req-state__title">We couldn’t load this request.</h1>
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
            <h1 className="req-state__title">Request not found</h1>
            <p className="req-state__body">
              This request doesn’t exist or isn’t one of your requests.
            </p>
            <Link to={MY_REQUESTS_PATH} className="req-view">
              Go to My Requests
            </Link>
          </div>
        )}

        {status === 'ready' && request && <RequestBody request={request} />}
      </div>
    </StudentLayout>
  )
}

export default StudentRequestDetails

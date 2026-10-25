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
import useRejectionReason from '../hooks/useRejectionReason'
import useProgramChangeDecision from '../hooks/useProgramChangeDecision'
import { PROGRAM_CHANGE, RAISE_CAPACITY, statusLabel } from '../utils/statusLabels'
import '../components/requests/Requests.css'

// Final outcomes use the same wording as the student notifications; a request
// type whose 'Completed' means an approval (statusLabel: Raise Capacity,
// Program Change) reads "approved".
const DECISION_HEADINGS: Record<string, { tone: string; glyph: string; heading: string }> = {
  Completed: { tone: 'completed', glyph: '✓', heading: 'Your request has been completed.' },
  Rejected: { tone: 'rejected', glyph: '✕', heading: 'Your request has been rejected.' },
}

function decisionHeading(request: Details) {
  const heading = DECISION_HEADINGS[request.status]
  if (heading && statusLabel(request.status, request.type) === 'Approved') {
    return { ...heading, heading: 'Your request has been approved.' }
  }
  return heading
}

// The administrator's explanation of a decided Program Change request, for
// approvals and rejections alike. A loading failure is reported as such, never
// as a missing explanation.
function ProgramChangeDecisionText({ requestId, rejected }: { requestId: string; rejected: boolean }) {
  const { status, decision, retry } = useProgramChangeDecision(requestId, true)
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
        (decision?.explanation ? (
          <p className="req-text__body">{decision.explanation}</p>
        ) : (
          <p className="req-state__body">No explanation recorded.</p>
        ))}
    </div>
  )
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

function Progress({ request }: { request: Details }) {
  const decided = request.status !== 'In Progress'
  const steps = [
    { title: 'Request submitted', meta: formatDate(request.date), state: 'done', glyph: '✓' },
    {
      title: 'Under review',
      meta: decided ? 'Review finished' : 'In progress',
      state: decided ? 'done' : 'current',
      glyph: decided ? '✓' : '◐',
    },
    decided
      ? {
          title: statusLabel(request.status, request.type),
          meta: request.decision ? formatDate(request.decision.date) : '',
          state: 'done',
          glyph: request.status === 'Rejected' ? '✕' : '✓',
        }
      : { title: 'Decision', meta: 'Not yet decided', state: 'pending', glyph: '' },
  ]
  const stateLabel: Record<string, string> = { done: 'done', current: 'current step', pending: 'not started' }

  return (
    <section className="req-panel req-progress" aria-labelledby="req-progress-title">
      <h2 id="req-progress-title" className="req-panel__title">
        Progress
      </h2>
      <ol className="req-progress__list">
        {steps.map((step) => (
          <li key={step.title} className="req-progress__step" data-state={step.state}>
            <div className="req-progress__rail">
              <span className="req-progress__dot" aria-hidden="true">
                {step.glyph}
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
  const decision = decisionHeading(request)
  const showRejectionReason = request.type === RAISE_CAPACITY && request.status === 'Rejected'
  const showProgramChangeDecision =
    request.type === PROGRAM_CHANGE && (request.status === 'Completed' || request.status === 'Rejected')

  return (
    <>
      <div className="req-detail__head">
        <div className="req-detail__meta-row">
          <span className="req-detail__id">{request.id}</span>
          <RequestStatusBadge status={request.status} requestType={request.type} />
        </div>
        <h1 className="req-detail__title">
          {request.type}
          {request.title ? ` · ${request.title}` : ''}
        </h1>
        <p className="req-detail__submitted">Submitted {formatDate(request.date)}</p>
      </div>

      <div className="req-detail__columns">
        <div className="req-detail__main">
          {decision ? (
            <section
              className="req-decision"
              data-tone={decision.tone}
              aria-labelledby="req-decision-title"
            >
              <div className="req-decision__head">
                <span aria-hidden="true">{decision.glyph}</span>
                <h2 id="req-decision-title" className="req-decision__title">
                  {decision.heading}
                </h2>
              </div>
              {request.decision && (
                <p className="req-decision__body">
                  Decided {formatDate(request.decision.date)}
                </p>
              )}
              {showRejectionReason && <RejectionReasonText requestId={request.id} />}
              {showProgramChangeDecision && (
                <ProgramChangeDecisionText requestId={request.id} rejected={request.status === 'Rejected'} />
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

          <section className="req-panel" aria-labelledby="req-submitted-title">
            <h2 id="req-submitted-title" className="req-panel__title">
              What you submitted
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
        </div>

        <Progress request={request} />
      </div>
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
      <div className="req-page">
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

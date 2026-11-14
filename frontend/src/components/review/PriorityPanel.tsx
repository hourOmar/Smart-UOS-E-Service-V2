import {
  PRIORITY_LABELS,
  type FactorExplanations,
  type PriorityLevel,
  type PriorityState,
} from '../../services/raiseCapacityPriority'

// The agent's seven factors, in the order of its saved result.
const FACTORS: [keyof FactorExplanations, string][] = [
  ['graduation', 'Graduation'],
  ['degree_progress', 'Degree progress'],
  ['course_requirement', 'Course requirement'],
  ['course_availability', 'Course availability'],
  ['previous_attempts', 'Previous attempts'],
  ['prerequisite', 'Prerequisite'],
  ['progression', 'Progression'],
]

interface PriorityPanelProps {
  status: 'loading' | 'ready' | 'error'
  data: PriorityState | null
  error: string | null
  onRetry: () => void
}

// The saved result exactly as the Prioritization Agent stored it: level,
// reasoning, factor explanations and key evidence. Nothing is reworded.
function PriorityCard({ level, data }: { level: PriorityLevel; data: PriorityState }) {
  const result = data.result
  const factors = result?.factor_explanations
  const evidence = (result?.key_evidence ?? []).filter((item) => item.trim() !== '')

  return (
    <div className="rv-rec rv-prio">
      <div className="rv-rec__head">
        <span className="rv-rec__label">Priority</span>
        <span className="adm-prio-pill" data-level={level}>
          {PRIORITY_LABELS[level]}
        </span>
        <span className="rv-rec__advisory">Advisory</span>
      </div>
      <div className="rv-rec__body">
        {result?.reasoning && <p className="rv-rec__reasoning">{result.reasoning}</p>}
        {factors && (
          <dl className="rv-explain">
            {FACTORS.map(([field, label]) =>
              factors[field] ? (
                <div key={field} className="rv-explain__item">
                  <dt>{label}</dt>
                  <dd>{factors[field]}</dd>
                </div>
              ) : null,
            )}
          </dl>
        )}
        {evidence.length > 0 && (
          <div className="rv-prio__evidence">
            <p className="rv-prio__evidence-title">Key evidence</p>
            <ul className="rv-prio__evidence-list">
              {evidence.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

function NoAssessment() {
  return <p className="rv-muted">No priority assessment has been recorded for this request.</p>
}

// One request's priority state, from the backend's state names.
function PriorityStateView({ data }: { data: PriorityState }) {
  switch (data.state) {
    case 'saved':
      return data.priority ? <PriorityCard level={data.priority} data={data} /> : <NoAssessment />
    case 'needs_attention':
      return (
        <div className="rv-alert" role="status">
          <p className="rv-alert__title">The saved priority needs attention</p>
          <p className="rv-alert__body">
            {data.attention_reason ?? 'The saved priority could not be shown.'} No priority is shown
            for this request.
          </p>
        </div>
      )
    case 'running':
      return (
        <p className="rv-running" role="status">
          <span className="rv-running__dot" aria-hidden="true" />
          A priority check is running for this request. This section updates when it finishes.
        </p>
      )
    case 'failed': {
      const interrupted = data.last_run?.status === 'interrupted'
      return (
        <div className="rv-alert" data-tone="failure" role="alert">
          <p className="rv-alert__title">
            {interrupted ? 'The latest priority check was interrupted' : 'The latest priority check failed'}
          </p>
          <p className="rv-alert__body">
            {data.last_run?.error_message ?? 'The check did not finish.'} This is a technical failure,
            not a priority.
          </p>
        </div>
      )
    }
    default:
      return <NoAssessment />
  }
}

// Staff review: the Prioritization Agent's saved assessment, read from the
// same endpoint as the requests table's Priority column. Read-only; it never
// starts or retries a check.
function PriorityPanel({ status, data, error, onRetry }: PriorityPanelProps) {
  return (
    <section
      className="req-panel rv-panel rv-priority"
      aria-labelledby="rv-priority-title"
      aria-busy={data?.state === 'running'}
    >
      <div className="rv-panel__head">
        <h2 id="rv-priority-title" className="req-panel__title rv-panel__title">
          Priority assessment
        </h2>
      </div>

      <div className="req-panel__body">
        <p className="rv-advisory-note">
          Advisory only. The priority assessment supports administrative review and does not
          approve or reject the request; staff make the decision.
        </p>

        {status === 'loading' && <p className="rv-muted" role="status">Loading the priority assessment…</p>}

        {status === 'error' && (
          <div className="rv-alert" data-tone="failure" role="alert">
            <p className="rv-alert__title">The priority assessment could not be loaded.</p>
            <p className="rv-alert__body">{error}</p>
            <button type="button" className="req-button" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}

        {status === 'ready' && (data ? <PriorityStateView data={data} /> : <NoAssessment />)}
      </div>
    </section>
  )
}

export default PriorityPanel

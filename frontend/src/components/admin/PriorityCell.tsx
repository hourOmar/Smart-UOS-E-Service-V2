import type { RaiseCapacityPriorities } from '../../hooks/useRaiseCapacityPriorities'
import type { PriorityLevel } from '../../services/raiseCapacityPriority'

const RAISE_CAPACITY = 'Raise Capacity'

const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  MANUAL_REVIEW: 'Manual review',
}

interface PriorityCellProps {
  requestId: string
  requestType: string
  priorities: RaiseCapacityPriorities
}

// The admin tables' Priority column (staff only). Raise Capacity requests show
// their saved priority or the check's state; other request types show "—".
function PriorityCell({ requestId, requestType, priorities }: PriorityCellProps) {
  if (requestType !== RAISE_CAPACITY) {
    return (
      <span className="adm-prio adm-prio--none">
        <span aria-hidden="true">—</span>
        <span className="student-visually-hidden">Not applicable</span>
      </span>
    )
  }

  const state = priorities.byId[requestId]
  // After a failed read only saved priorities (which cannot change here) stay
  // on screen; anything else could be stale.
  if (priorities.status === 'unavailable' && state?.state !== 'saved') {
    return <span className="adm-prio adm-prio--muted">Unavailable</span>
  }
  if (!state) return <span className="adm-prio adm-prio--muted">Loading…</span>

  switch (state.state) {
    case 'saved':
      return state.priority ? (
        <span className="adm-prio-pill" data-level={state.priority}>
          {PRIORITY_LABELS[state.priority]}
        </span>
      ) : null
    case 'needs_attention':
      return (
        <span className="adm-prio-pill" data-level="attention" title={state.attention_reason ?? undefined}>
          Needs attention
          <span className="student-visually-hidden">: {state.attention_reason}</span>
        </span>
      )
    case 'running':
      return <Checking label="Checking…" />
    case 'not_started':
      return state.auto_eligible ? (
        <Checking label="Queued…" />
      ) : (
        <span className="adm-prio adm-prio--muted">Not checked</span>
      )
    case 'failed':
      return <Failed requestId={requestId} priorities={priorities} />
    default:
      return (
        <span className="adm-prio adm-prio--none">
          <span aria-hidden="true">—</span>
          <span className="student-visually-hidden">No priority</span>
        </span>
      )
  }
}

function Checking({ label }: { label: string }) {
  return (
    <span className="adm-prio adm-prio--checking" role="status">
      <span className="adm-prio__dot" aria-hidden="true" />
      {label}
    </span>
  )
}

function Failed({ requestId, priorities }: { requestId: string; priorities: RaiseCapacityPriorities }) {
  const state = priorities.byId[requestId]
  const interrupted = state.last_run?.status === 'interrupted'
  const reason = state.last_run?.error_message ?? undefined
  const retrying = priorities.retrying[requestId]
  const retryError = priorities.retryErrors[requestId]

  return (
    <span className="adm-prio-failed">
      <span className="adm-prio adm-prio--failed" title={reason}>
        {interrupted ? 'Check interrupted' : 'Check failed'}
        {reason && <span className="student-visually-hidden">: {reason}</span>}
      </span>
      {state.can_retry && (
        <button
          type="button"
          className="adm-prio__retry"
          disabled={retrying}
          onClick={() => void priorities.retry(requestId)}
        >
          {retrying ? 'Retrying…' : 'Retry'}
          <span className="student-visually-hidden"> priority check for {requestId}</span>
        </button>
      )}
      {retryError && (
        <span className="adm-prio__error" role="alert">
          {retryError}
        </span>
      )}
    </span>
  )
}

export function PriorityNotice({ priorities }: { priorities: RaiseCapacityPriorities }) {
  if (!priorities.notice) return null
  return (
    <div className="adm-prio-notice" role="alert">
      <span>
        {priorities.status === 'unavailable'
          ? `Priorities couldn’t be loaded. ${priorities.notice}`
          : priorities.notice}
      </span>
      {priorities.status === 'unavailable' && (
        <button type="button" className="adm-prio__retry" onClick={priorities.reload}>
          Try again
        </button>
      )}
    </div>
  )
}

export default PriorityCell

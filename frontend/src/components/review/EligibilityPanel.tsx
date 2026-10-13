import type { EvaluationRun, EvaluationState, Recommendation } from '../../services/raiseCapacityReview'
import { formatDateTime } from './format'

const RECOMMENDATIONS: Record<Recommendation, { tone: string; glyph: string; label: string }> = {
  APPROVE: { tone: 'approve', glyph: '✓', label: 'Recommends approval' },
  REJECT: { tone: 'reject', glyph: '✕', label: 'Recommends rejection' },
  MANUAL_REVIEW: { tone: 'manual', glyph: '◐', label: 'Recommends manual review' },
}

const TRIGGERS: Record<string, string> = { first_open: 'first opening', rerun: 're-run' }

interface EligibilityPanelProps {
  status: 'loading' | 'ready' | 'error'
  data: EvaluationState | null
  error: string | null
  running: boolean
  notice: string | null
  onRerun: () => void
  onRetry: () => void
  /** The request already has a final status (no automatic check). */
  finalized: boolean
}

function RunMeta({ run }: { run: EvaluationRun }) {
  const parts = [
    run.evaluated_at ? `Evaluated ${formatDateTime(run.evaluated_at)}` : null,
    TRIGGERS[run.trigger] ? `on ${TRIGGERS[run.trigger]}` : null,
    run.model ? `model ${run.model}` : null,
    run.agent_version ? `agent v${run.agent_version}` : null,
  ].filter(Boolean)
  return <p className="rv-meta">{parts.join(' · ')}</p>
}

// A completed run whose decision Gemini could not make: evidence only.
function NoAutomatedDecision({ run }: { run: EvaluationRun }) {
  return (
    <div className="rv-alert" data-tone="technical" role="status">
      <p className="rv-alert__title">No automated recommendation</p>
      <p className="rv-alert__body">
        The decision service (Gemini) was unavailable when this check ran, so only the evidence
        was collected. This is a technical gap, not a Manual Review recommendation. Review the
        evidence yourself or re-run the check.
      </p>
      <RunMeta run={run} />
    </div>
  )
}

function RecommendationCard({ run }: { run: EvaluationRun }) {
  if (run.gemini_status !== 'ok' || !run.recommendation) return <NoAutomatedDecision run={run} />
  const rec = RECOMMENDATIONS[run.recommendation]
  const checks = run.check_explanations ?? {}
  return (
    <div className="rv-rec" data-tone={rec.tone}>
      <div className="rv-rec__head">
        <span aria-hidden="true">{rec.glyph}</span>
        <span className="rv-rec__label">{rec.label}</span>
        <span className="rv-rec__advisory">Advisory</span>
      </div>
      <div className="rv-rec__body">
        {run.reasoning && <p className="rv-rec__reasoning">{run.reasoning}</p>}
        <dl className="rv-explain">
          {[
            ['Prerequisite', checks.prerequisite],
            ['Completed hours', checks.completed_hours],
            ['Section capacity', checks.capacity],
          ].map(([label, value]) =>
            value ? (
              <div key={label} className="rv-explain__item">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ) : null,
          )}
        </dl>
        <RunMeta run={run} />
      </div>
    </div>
  )
}

// A newer attempt that did not replace the result above.
function LatestAttempt({ run, hasCurrent }: { run: EvaluationRun; hasCurrent: boolean }) {
  if (run.run_status === 'running') return null
  const kept = hasCurrent ? ' The result above is the last successful check and has not been replaced.' : ''
  if (run.run_status === 'completed') {
    // Completed without a Gemini decision while an earlier Gemini result exists.
    return (
      <div className="rv-alert" data-tone="technical" role="status">
        <p className="rv-alert__title">Latest re-run produced no automated recommendation</p>
        <p className="rv-alert__body">
          Gemini was unavailable{run.evaluated_at ? ` at ${formatDateTime(run.evaluated_at)}` : ''}.{kept}
        </p>
      </div>
    )
  }
  const when = formatDateTime(run.evaluated_at ?? run.started_at)
  return (
    <div className="rv-alert" data-tone="failure" role="alert">
      <p className="rv-alert__title">
        {run.run_status === 'interrupted' ? 'Latest check was interrupted' : 'Latest check failed'}
        {when ? ` (${when})` : ''}
      </p>
      <p className="rv-alert__body">
        {run.error_message ?? 'The check did not finish.'} This is a technical failure, not a
        recommendation.{kept}
      </p>
    </div>
  )
}

function EligibilityPanel({ status, data, error, running, notice, onRerun, onRetry, finalized }: EligibilityPanelProps) {
  const active = running || Boolean(data?.in_progress)
  const current = data?.current ?? null
  const attempt = data?.latest_attempt ?? null

  return (
    <section className="req-panel rv-panel rv-eligibility" aria-labelledby="rv-eligibility-title" aria-busy={active}>
      <div className="rv-panel__head">
        <h2 id="rv-eligibility-title" className="req-panel__title rv-panel__title">
          Eligibility recommendation
        </h2>
        {status !== 'loading' && !(status === 'error' && !data) && (
          <button type="button" className="rv-rerun" onClick={onRerun} disabled={active}>
            {active ? 'Check running…' : 'Re-run eligibility check'}
          </button>
        )}
      </div>

      <div className="req-panel__body">
        <p className="rv-advisory-note">
          Advisory only. The recommendation does not approve or reject the request; staff make
          the decision.
        </p>

        {status === 'loading' && <p className="rv-muted" role="status">Loading the eligibility check…</p>}

        {status === 'error' && !data && (
          <div className="rv-alert" data-tone="failure" role="alert">
            <p className="rv-alert__title">The eligibility check could not be loaded.</p>
            <p className="rv-alert__body">{error}</p>
            <button type="button" className="req-button" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}

        {active && (
          <p className="rv-running" role="status">
            <span className="rv-running__dot" aria-hidden="true" />
            {running
              ? 'Running the eligibility check. This can take up to a minute.'
              : 'An eligibility check is already running for this request. This page updates when it finishes.'}
          </p>
        )}

        {notice && (
          <p className="rv-notice" role="alert">
            {notice}
          </p>
        )}

        {current && <RecommendationCard run={current} />}
        {attempt && <LatestAttempt run={attempt} hasCurrent={Boolean(current)} />}

        {status === 'ready' && data && !current && !attempt && !active && (
          <p className="rv-muted">
            {finalized ? 'No eligibility evaluation recorded.' : 'No eligibility check has been run for this request yet.'}
          </p>
        )}
      </div>
    </section>
  )
}

export default EligibilityPanel

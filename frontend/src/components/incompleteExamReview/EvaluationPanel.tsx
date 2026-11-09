import { formatDateTime } from '../review/format'
import {
  CHECK_EXPLANATION_LABELS,
  rejectionSuggestions,
  verifiedChecks,
  type CheckTone,
  type IncompleteExamEvaluationState,
  type IncompleteExamRecommendation,
  type IncompleteExamRun,
} from '../../utils/incompleteExamEvaluation'

const RECOMMENDATIONS: Record<IncompleteExamRecommendation, { tone: string; glyph: string; label: string }> = {
  APPROVE: { tone: 'approve', glyph: '✓', label: 'APPROVE' },
  REJECT: { tone: 'reject', glyph: '✕', label: 'REJECT' },
  MANUAL_REVIEW: { tone: 'review', glyph: '!', label: 'MANUAL REVIEW' },
}

const CHECK_STATUS: Record<CheckTone, { glyph: string; label: string }> = {
  pass: { glyph: '✓', label: 'PASSED' },
  fail: { glyph: '✕', label: 'FAILED' },
  unknown: { glyph: '–', label: 'NOT CONFIRMED' },
}

const CONFLICT_WARNING =
  'The agent recommends APPROVE although a verified check failed. Review the checks and proof documents carefully before deciding.'

const DOCUMENT_AUTHENTICITY_NOTICE =
  'The AI reads the contents of the proof documents but does not verify that they are authentic. Review the supporting documents yourself before deciding.'

// Why a run failed, in words that match its failure_kind. Never a recommendation.
const FAILURE_NOTES: Record<string, string> = {
  data: 'The request’s data stopped the evaluation; evaluating again gives the same result until the data is corrected.',
  technical: 'This is a technical failure, not a recommendation.',
  interrupted: 'The evaluation did not finish. This is a technical failure, not a recommendation.',
}

interface EvaluationPanelProps {
  status: 'loading' | 'ready' | 'error'
  data: IncompleteExamEvaluationState | null
  error: string | null
  running: boolean
  notice: string | null
  canStartFirst: boolean
  canRerun: boolean
  /** Staff action only: false for the first evaluation, true to evaluate again. */
  onRun: (rerun: boolean) => void
  onRetry: () => void
  /** The request's current status from the database (null while loading). */
  requestStatus: string | null
  /** Fills the administrator's explanation; null when no decision can be made now. */
  onUseReason: ((text: string) => void) | null
}

function Suggestions({ run, onUseReason }: { run: IncompleteExamRun; onUseReason: ((text: string) => void) | null }) {
  const suggestions = rejectionSuggestions(run)
  if (!suggestions) return null
  return (
    <div className="ier-suggest" aria-labelledby="ier-suggest-title">
      <div className="ier-suggest__head">
        <span id="ier-suggest-title" className="pcr-column__label">
          Suggested explanations to the student
        </span>
        <span className="ier-suggest__agent">Rejection Explanation Agent · editable before use</span>
      </div>
      {suggestions.policyReasons.length > 0 && (
        <p className="ier-suggest__basis">
          <strong>Verified reasons:</strong> {suggestions.policyReasons.join('; ')}
        </p>
      )}
      {suggestions.assessedReasons.length > 0 && (
        <p className="ier-suggest__basis">
          <strong>Assessed reasons:</strong> {suggestions.assessedReasons.join('; ')}{' '}
          <span className="rv-muted">(the AI’s assessment of the documents and explanation, not a verified record)</span>
        </p>
      )}
      {suggestions.conflictNote && (
        <p className="pcr-warning" role="note">
          <span aria-hidden="true">! </span>
          {suggestions.conflictNote}
        </p>
      )}
      {suggestions.message && <p className="rv-muted">{suggestions.message}</p>}
      {suggestions.reasons.length > 0 && (
        <ul className="ier-suggest__list">
          {suggestions.reasons.map((reason, index) => (
            <li key={`${reason.tone}-${index}`} className="ier-suggest__item">
              <span className="ier-suggest__tone">{reason.label}</span>
              <p className="ier-suggest__text">{reason.text}</p>
              {onUseReason && (
                <button type="button" className="pcr-rerun" onClick={() => onUseReason(reason.text)}>
                  Use this reason
                  <span className="student-visually-hidden"> ({reason.label})</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!onUseReason && suggestions.reasons.length > 0 && (
        <span className="rv-muted">Suggestions can be used only while the request is awaiting a decision.</span>
      )}
    </div>
  )
}

function Results({ run, onUseReason }: { run: IncompleteExamRun; onUseReason: ((text: string) => void) | null }) {
  const rec = run.recommendation ? RECOMMENDATIONS[run.recommendation] : null
  const checks = verifiedChecks(run.deterministic_results)
  const explanations = run.check_explanations

  return (
    <>
      {run.recommendation_conflict && (
        <p className="pcr-conflict" role="alert">
          <span aria-hidden="true">! </span>
          {CONFLICT_WARNING}
        </p>
      )}
      <div className="pcr-columns">
        <div className="pcr-column">
          <span className="pcr-column__label">Agent recommendation</span>
          {rec ? (
            <span className="pcr-verdict" data-tone={rec.tone}>
              <span aria-hidden="true">{rec.glyph}</span>
              {rec.label}
            </span>
          ) : (
            <span className="pcr-verdict" data-tone="none">Not recorded</span>
          )}
          {run.reasoning ? (
            <p className="pcr-summary">{run.reasoning}</p>
          ) : (
            <p className="rv-muted">No reasoning was recorded for this evaluation.</p>
          )}
          <span className="pcr-advisory">
            <span aria-hidden="true">ⓘ</span>
            Advisory only — the final decision belongs to the administrator.
          </span>
        </div>

        <div className="pcr-column">
          <span className="pcr-column__label">Verified checks (database)</span>
          {checks ? (
            checks.map((check) => {
              const status = CHECK_STATUS[check.tone]
              return (
                <div key={check.key} className="pcr-check" data-tone={check.tone}>
                  <div className="pcr-check__head">
                    <span className="pcr-check__name">{check.name}</span>
                    <span className="pcr-check__status">
                      <span aria-hidden="true">{status.glyph}</span>
                      {status.label}
                    </span>
                  </div>
                  <span className="ier-check__value">{check.value}</span>
                  <span className="pcr-check__detail">{check.detail}</span>
                </div>
              )
            })
          ) : (
            <p className="rv-muted">No verified checks were recorded for this evaluation.</p>
          )}
        </div>

        <div className="pcr-column pcr-column--last">
          <span className="pcr-column__label">Agent’s check explanations</span>
          {explanations ? (
            <dl className="ier-explanations">
              {CHECK_EXPLANATION_LABELS.map(({ key, label }) => (
                <div key={key} className="ier-explanations__item">
                  <dt>{label}</dt>
                  <dd>{explanations[key]?.trim() || 'Not recorded'}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="rv-muted">No check explanations were recorded for this evaluation.</p>
          )}
        </div>
      </div>
      <Suggestions run={run} onUseReason={onUseReason} />
      <p className="ier-meta">
        {[
          run.assessment_model && `Eligibility model ${run.assessment_model}`,
          run.rejection_model && `explanation model ${run.rejection_model}`,
          run.agent_version && `agent ${run.agent_version}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </>
  )
}

function FailedAttempt({ run, canRetry, onRetry }: { run: IncompleteExamRun; canRetry: boolean; onRetry: () => void }) {
  const when = formatDateTime(run.finished_at ?? run.started_at)
  return (
    <div className="pcr-state pcr-state--error" role="alert">
      <div className="pcr-state__text">
        <span className="pcr-state__title">
          ! Technical failure: the evaluation couldn’t be completed{when ? ` (${when})` : ''}
        </span>
        <span className="pcr-state__body">
          {run.error_message ?? 'The evaluation did not finish.'}{' '}
          {FAILURE_NOTES[run.failure_kind ?? 'technical'] ?? FAILURE_NOTES.technical} No recommendation was recorded —
          you can evaluate again or review the request and proof documents yourself.
        </span>
      </div>
      {canRetry && (
        <button type="button" className="pcr-primary" onClick={onRetry}>
          Re-evaluate
        </button>
      )}
    </div>
  )
}

// The Incomplete Exam agents' saved evaluation (Agent 5: eligibility; Agent 6:
// suggested rejection explanations). Opening the page only shows what is
// saved: the agents, which send the request and its proof documents to the AI
// service, run only when staff click Run Evaluation or Re-evaluate.
function EvaluationPanel({
  status,
  data,
  error,
  running,
  notice,
  canStartFirst,
  canRerun,
  onRun,
  onRetry,
  requestStatus,
  onUseReason,
}: EvaluationPanelProps) {
  const active = running || Boolean(data?.in_progress)
  const current = data?.current ?? null
  const attempt = data?.latest_attempt ?? null
  const failed = attempt && (attempt.run_status === 'failed' || attempt.run_status === 'interrupted') ? attempt : null
  const effectiveStatus = requestStatus ?? data?.request_status ?? null
  const finalized = effectiveStatus !== null && effectiveStatus !== 'In Progress'
  // Both the request's own status and the saved state must allow a run.
  const rerunAllowed = canRerun && !finalized
  const firstAllowed = canStartFirst && !finalized
  const lastEvaluated = formatDateTime(current?.finished_at)

  return (
    <section className="pcr-ai" aria-labelledby="ier-ai-title" aria-busy={active}>
      <div className="pcr-ai__head">
        <div className="pcr-ai__heading">
          <h2 id="ier-ai-title" className="pcr-ai__title">
            AI Agent Evaluation
          </h2>
          <span className="pcr-ai__agent">Incomplete Exam Eligibility Agent</span>
        </div>
        {current && (
          <div className="pcr-ai__tools">
            {lastEvaluated && <span className="pcr-ai__generated">Last evaluated {lastEvaluated}</span>}
            <button
              type="button"
              className="pcr-rerun"
              onClick={() => onRun(true)}
              disabled={!rerunAllowed}
              title={
                finalized
                  ? 'This request has been decided; it is not evaluated again.'
                  : active
                    ? 'An evaluation is running.'
                    : !rerunAllowed
                      ? 'Only In Progress requests with details can be evaluated again.'
                      : undefined
              }
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
              </svg>
              {active ? 'Evaluating…' : 'Re-evaluate'}
            </button>
          </div>
        )}
      </div>

      <p className="ier-authenticity" role="note">
        <span aria-hidden="true">ⓘ</span>
        <span>{DOCUMENT_AUTHENTICITY_NOTICE}</span>
      </p>

      {status === 'loading' && (
        <p className="pcr-state" role="status">
          Loading the saved evaluation…
        </p>
      )}

      {status === 'error' && !data && (
        <div className="pcr-state pcr-state--error" role="alert">
          <div className="pcr-state__text">
            <span className="pcr-state__title">! The evaluation could not be loaded</span>
            <span className="pcr-state__body">{error}</span>
          </div>
          <button type="button" className="pcr-primary" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}

      {data?.details_missing && (
        <p className="rv-notice pcr-notice" role="alert">
          {data.details_missing_message ??
            'This request has no Incomplete Exam details (course, exam and proof), so it cannot be evaluated.'}
        </p>
      )}

      {active && (
        <div className="pcr-state" role="status" aria-live="polite">
          <span className="pcr-state__running">
            <span className="pcr-spinner" aria-hidden="true" />
            Evaluating eligibility…
          </span>
          <span className="pcr-state__body">
            {running
              ? 'The agent is reading the request and its proof documents. This can take a minute or two.'
              : 'An evaluation is already running for this request. This page updates when it finishes.'}
          </span>
        </div>
      )}

      {notice && (
        <p className="rv-notice pcr-notice" role="alert">
          {notice}
        </p>
      )}

      {/* A newer attempt failed: the last successful result stays below. */}
      {current && failed && !active && (
        <p className="rv-notice pcr-notice" role="alert">
          Technical failure: the latest re-evaluation
          {formatDateTime(failed.finished_at) ? ` (${formatDateTime(failed.finished_at)})` : ''} did not complete:{' '}
          {failed.error_message ?? 'the evaluation did not finish.'} The result below is the last successful evaluation
          and has not been replaced.
        </p>
      )}

      {!current && failed && !active && (
        <FailedAttempt run={failed} canRetry={rerunAllowed} onRetry={() => onRun(true)} />
      )}

      {status === 'ready' && data && !data.details_missing && !current && !failed && !active && (
        <div className="pcr-state pcr-state--empty">
          <p className="pcr-state__body">
            {finalized
              ? 'No evaluation was recorded for this request. Evaluations run only while a request is In Progress.'
              : 'This request has not been evaluated. Run Evaluation sends the request and its proof documents to the AI service to check enrolment, the submission window, the proof, the reason and the exam type. The result is a recommendation only — it does not change the request or notify the student. Opening this page never starts an evaluation.'}
          </p>
          {firstAllowed && (
            <button type="button" className="pcr-primary" onClick={() => onRun(false)}>
              Run Evaluation
            </button>
          )}
        </div>
      )}

      {current && <Results key={current.id} run={current} onUseReason={onUseReason} />}
    </section>
  )
}

export default EvaluationPanel

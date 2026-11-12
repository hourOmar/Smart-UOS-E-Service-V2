import { formatDateTime } from '../review/format'
import {
  ADVISORY_NOTE,
  checkRows,
  rejectionSuggestions,
  summerLimitation,
  termLabel,
  type CheckTone,
  type CourseSubstitutionEvaluationState,
  type CourseSubstitutionResult,
  type CourseSubstitutionRun,
} from '../../utils/courseSubstitutionEvaluation'

const RESULTS: Record<CourseSubstitutionResult, { tone: string; glyph: string; label: string }> = {
  ELIGIBLE: { tone: 'approve', glyph: '✓', label: 'ELIGIBLE' },
  NOT_ELIGIBLE: { tone: 'reject', glyph: '✕', label: 'NOT ELIGIBLE' },
  MANUAL_REVIEW: { tone: 'review', glyph: '!', label: 'MANUAL REVIEW' },
}

const CHECK_GLYPHS: Record<CheckTone, string> = { pass: '✓', fail: '✕', review: '!' }

// Why a run failed, in words that match its failure_kind. Never a result.
const FAILURE_NOTES: Record<string, string> = {
  data: 'The request’s data stopped the evaluation; evaluating again gives the same result until the data is corrected.',
  technical: 'This is a technical failure, not an eligibility result.',
  interrupted: 'The evaluation did not finish. This is a technical failure, not an eligibility result.',
}

interface EvaluationPanelProps {
  status: 'loading' | 'ready' | 'error'
  data: CourseSubstitutionEvaluationState | null
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

function Suggestions({ run, onUseReason }: { run: CourseSubstitutionRun; onUseReason: ((text: string) => void) | null }) {
  const suggestions = rejectionSuggestions(run)
  if (!suggestions) return null
  return (
    <div className="ier-suggest" aria-labelledby="csr-suggest-title">
      <div className="ier-suggest__head">
        <span id="csr-suggest-title" className="pcr-column__label">
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
          <span className="rv-muted">(the AI’s assessment, not a verified record)</span>
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
          {suggestions.reasons.map((reason) => (
            <li key={reason.tone} className="ier-suggest__item">
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

function Results({ run, onUseReason }: { run: CourseSubstitutionRun; onUseReason: ((text: string) => void) | null }) {
  const result = run.overall_result ? RESULTS[run.overall_result] : null
  const checks = checkRows(run)
  const summer = summerLimitation(run)
  const term = termLabel(run)

  return (
    <>
      <div className="pcr-columns csr-columns">
        <div className="pcr-column">
          <span className="pcr-column__label">Overall result</span>
          {result ? (
            <span className="pcr-verdict" data-tone={result.tone}>
              <span aria-hidden="true">{result.glyph}</span>
              {result.label}
            </span>
          ) : (
            <span className="pcr-verdict" data-tone="none">Not recorded</span>
          )}
          <dl className="csr-term">
            <dt>Term checked</dt>
            <dd>{term ?? 'Not determined'}</dd>
          </dl>
          {summer && (
            <p className="pcr-warning" role="note">
              <span aria-hidden="true">! </span>
              {summer}
            </p>
          )}
          {run.gemini_error && (
            <p className="rv-muted csr-gemini">
              An AI step fell back to its safe default: {run.gemini_error}
            </p>
          )}
          <span className="pcr-advisory">
            <span aria-hidden="true">ⓘ</span>
            {ADVISORY_NOTE}
          </span>
        </div>

        <div className="pcr-column pcr-column--last">
          <span className="pcr-column__label">Eligibility checks</span>
          {checks ? (
            checks.map((check) => (
              <div key={check.key} className="pcr-check" data-tone={check.tone}>
                <div className="pcr-check__head">
                  <span className="pcr-check__name">{check.condition}</span>
                  <span className="pcr-check__status">
                    <span aria-hidden="true">{CHECK_GLYPHS[check.tone]}</span>
                    {check.label}
                  </span>
                </div>
                <span className="pcr-check__detail">{check.evidence}</span>
              </div>
            ))
          ) : (
            <p className="rv-muted">No eligibility checks were recorded for this evaluation.</p>
          )}
        </div>
      </div>
      <Suggestions run={run} onUseReason={onUseReason} />
      <p className="ier-meta">
        {[
          run.study_plan_model && `Study plan model ${run.study_plan_model}`,
          run.rejection_model && `explanation model ${run.rejection_model}`,
          run.agent_version && `agent ${run.agent_version}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </>
  )
}

function FailedAttempt({ run, canRetry, onRetry }: { run: CourseSubstitutionRun; canRetry: boolean; onRetry: () => void }) {
  const when = formatDateTime(run.finished_at ?? run.started_at)
  const interrupted = run.run_status === 'interrupted'
  return (
    <div className="pcr-state pcr-state--error" role="alert">
      <div className="pcr-state__text">
        <span className="pcr-state__title">
          ! {interrupted ? 'Interrupted' : 'Failed'}: the evaluation couldn’t be completed{when ? ` (${when})` : ''}
        </span>
        <span className="pcr-state__body">
          {run.error_message ?? 'The evaluation did not finish.'}{' '}
          {FAILURE_NOTES[run.failure_kind ?? 'technical'] ?? FAILURE_NOTES.technical} No result was recorded — you can
          evaluate again or review the request yourself.
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

// The Course Substitution agent's saved evaluation (the five eligibility
// checks, the overall result and, for NOT_ELIGIBLE, suggested rejection
// explanations). Opening the page only shows what is saved: the agent, which
// sends the request to the AI service, runs only when staff click Run
// Evaluation or Re-evaluate.
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
    <section className="pcr-ai" aria-labelledby="csr-ai-title" aria-busy={active}>
      <div className="pcr-ai__head">
        <div className="pcr-ai__heading">
          <h2 id="csr-ai-title" className="pcr-ai__title">
            AI Agent Evaluation
          </h2>
          <span className="pcr-ai__agent">Course Substitution Eligibility Agent · advisory</span>
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
            'This request has no Course Substitution details (original and proposed course), so it cannot be evaluated.'}
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
              ? 'The agent is checking the request against the study plan and course offerings. This can take a minute.'
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
          The latest re-evaluation
          {formatDateTime(failed.finished_at) ? ` (${formatDateTime(failed.finished_at)})` : ''}{' '}
          {failed.run_status === 'interrupted' ? 'was interrupted' : 'failed'}:{' '}
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
              : 'This request has not been evaluated. Run Evaluation sends the request to the AI service to check the five substitution conditions. The result is advisory only — it does not change the request or notify the student. Opening this page never starts an evaluation.'}
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

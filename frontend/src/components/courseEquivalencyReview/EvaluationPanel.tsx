import { formatDateTime } from '../review/format'
import {
  ADVISORY_NOTICE,
  CHECK_STATUS_TONE,
  LEGACY_MANUAL_START_NOTICE,
  FAILURE_NOTES,
  RECOMMENDATION_DISPLAY,
  SIMILARITY_COMPONENTS,
  draftThresholdsNotice,
  evaluationPanelView,
  matchSummary,
  outdatedMessage,
  rejectionSuggestions,
  safeguardChecks,
  scoreBandLabel,
  type CheckTone,
  type CourseEquivalencyEvaluationState,
  type CourseEquivalencyRun,
} from '../../utils/courseEquivalencyEvaluation'

const CHECK_STATUS: Record<CheckTone, { glyph: string; label: string }> = {
  pass: { glyph: '✓', label: 'PASSED' },
  fail: { glyph: '✕', label: 'FAILED' },
  unknown: { glyph: '–', label: 'NOT CONFIRMED' },
}

interface EvaluationPanelProps {
  status: 'loading' | 'ready' | 'error'
  data: CourseEquivalencyEvaluationState | null
  error: string | null
  running: boolean
  notice: string | null
  canStartFirst: boolean
  canRerun: boolean
  onRun: (rerun: boolean) => void
  onRetry: () => void
}

function Similarity({ run }: { run: CourseEquivalencyRun }) {
  const sim = run.deterministic_results?.similarity ?? null
  const request = run.deterministic_results?.syllabus_request
  if (!sim) {
    return (
      <div className="cer-similarity">
        <span className="pcr-column__label">Syllabus similarity</span>
        <p className="rv-muted">{request ?? 'No similarity score was calculated for this evaluation.'}</p>
      </div>
    )
  }
  const summary = matchSummary(sim)
  return (
    <div className="cer-similarity">
      <span className="pcr-column__label">Syllabus similarity (calculated by code from the AI’s verified matches)</span>
      <div className="cer-similarity__overall">
        <span className="cer-similarity__value">
          {sim.overall_similarity_percent === null ? '—' : `${sim.overall_similarity_percent}%`}
        </span>
        <span className="cer-similarity__band">{scoreBandLabel(sim)}</span>
      </div>
      <dl className="cer-components">
        {SIMILARITY_COMPONENTS.map((c) => {
          const value = sim.components_percent[c.key]
          return (
            <div key={c.key} className="cer-components__item">
              <dt>
                {c.label} <span className="rv-muted">(weight {c.weight}%)</span>
              </dt>
              <dd>
                <span className="cer-meter" aria-hidden="true">
                  <span className="cer-meter__bar" style={{ width: `${value ?? 0}%` }} />
                </span>
                {value === null ? 'Not stated' : `${value}%`}
              </dd>
            </div>
          )
        })}
      </dl>
      {summary && <p className="rv-muted">{summary}</p>}
      {sim.verification_ok === false && (
        <p className="pcr-warning" role="note">
          <span aria-hidden="true">! </span>Many of the AI’s matches could not be confirmed in the syllabus text, so approval was withheld.
        </p>
      )}
      {sim.credit_hours.note && <p className="rv-muted">{sim.credit_hours.note}</p>}
      {(sim.new_topics_not_covered.length > 0 || sim.new_outcomes_not_covered.length > 0) && (
        <div className="cer-uncovered">
          {sim.new_topics_not_covered.length > 0 && (
            <>
              <span className="pcr-column__label">Requested-course topics not covered</span>
              <ul>{sim.new_topics_not_covered.map((t, i) => <li key={`t${i}`}>{t}</li>)}</ul>
            </>
          )}
          {sim.new_outcomes_not_covered.length > 0 && (
            <>
              <span className="pcr-column__label">Learning outcomes not covered</span>
              <ul>{sim.new_outcomes_not_covered.map((t, i) => <li key={`o${i}`}>{t}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Suggestions({ run }: { run: CourseEquivalencyRun }) {
  const s = rejectionSuggestions(run)
  if (!s) return null
  return (
    <div className="ier-suggest" aria-labelledby="cer-suggest-title">
      <div className="ier-suggest__head">
        <span id="cer-suggest-title" className="pcr-column__label">
          Suggested explanations to the student
        </span>
        <span className="ier-suggest__agent">Rejection Explanation Agent · staff only · edit before use</span>
      </div>
      {s.verified.length > 0 && (
        <p className="ier-suggest__basis">
          <strong>Verified reasons:</strong> {s.verified.join('; ')}
        </p>
      )}
      {s.judged.length > 0 && (
        <p className="ier-suggest__basis">
          <strong>Assessed reasons:</strong> {s.judged.join('; ')} <span className="rv-muted">(the AI’s assessment, not a verified record)</span>
        </p>
      )}
      {s.statusNote && <p className="rv-muted">{s.statusNote}</p>}
      {s.reasons.length > 0 && (
        <ul className="ier-suggest__list">
          {s.reasons.map((reason, index) => (
            <li key={`${reason.tone}-${index}`} className="ier-suggest__item">
              <span className="ier-suggest__tone">{reason.label}</span>
              <p className="ier-suggest__text">{reason.text}</p>
            </li>
          ))}
        </ul>
      )}
      {s.notes.length > 0 && <p className="rv-muted">{s.notes.join(' ')}</p>}
    </div>
  )
}

function Results({ run }: { run: CourseEquivalencyRun }) {
  const rec = run.recommendation ? RECOMMENDATION_DISPLAY[run.recommendation] : null
  const checks = safeguardChecks(run.deterministic_results)
  const explanations = run.check_explanations ?? []
  const results = run.deterministic_results
  return (
    <>
      <div className="pcr-columns">
        <div className="pcr-column">
          <span className="pcr-column__label">Agent recommendation (advisory)</span>
          {rec ? (
            <span className="pcr-verdict" data-tone={rec.tone}>
              <span aria-hidden="true">{rec.glyph}</span>
              {rec.label}
            </span>
          ) : (
            <span className="pcr-verdict" data-tone="none">Not recorded</span>
          )}
          {rec && <span className="rv-muted">{rec.meaning}</span>}
          {run.reasoning ? <p className="pcr-summary">{run.reasoning}</p> : <p className="rv-muted">No reasoning was recorded.</p>}
          <span className="pcr-advisory">
            <span aria-hidden="true">ⓘ</span>
            {ADVISORY_NOTICE}
          </span>
        </div>
        <div className="pcr-column">
          <span className="pcr-column__label">Academic safeguards (verified by code)</span>
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
            <p className="rv-muted">No verified checks were recorded.</p>
          )}
        </div>
        <div className="pcr-column pcr-column--last">
          <span className="pcr-column__label">Agent’s check explanations</span>
          {explanations.length ? (
            <dl className="ier-explanations">
              {explanations.map((e, i) => (
                <div key={`${e.name}-${i}`} className="ier-explanations__item" data-tone={CHECK_STATUS_TONE[e.status] ?? 'unknown'}>
                  <dt>
                    {e.name.replace(/_/g, ' ')} · {e.status}
                  </dt>
                  <dd>{e.explanation?.trim() || 'Not recorded'}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="rv-muted">No check explanations were recorded.</p>
          )}
        </div>
      </div>
      <Similarity run={run} />
      {results && (
        <details className="cer-evidence">
          <summary>Evidence summary</summary>
          <ul>
            <li>
              Completed course: {results.old_course.course_id} {results.old_course.name ?? ''} · grade{' '}
              {results.old_course.grade ?? 'not found'}
              {results.old_course.term ? ` (term ${results.old_course.term})` : ''} · {results.old_course.in_transcript ? 'in the transcript' : 'not in the transcript'}
            </li>
            <li>
              Requested course: {results.new_course.course_id} {results.new_course.name ?? ''} · {results.new_course.credit_hours ?? '?'} credit hours
            </li>
            <li>
              Syllabi: old {results.syllabi.old.readable ? 'readable' : 'not readable'}, new{' '}
              {results.syllabi.new.readable ? 'readable' : 'not readable'}
              {results.text_overlap_percent !== null ? ` · plain word overlap ${results.text_overlap_percent}% (supporting evidence only)` : ''}
            </li>
            {(run.evaluated_syllabi ?? []).map((ref) => (
              <li key={ref.syllabus_id}>
                Evaluated {ref.side}-course file: {ref.file_name} ({ref.text_chars} characters of text read)
              </li>
            ))}
            {results.constraints.gpa_impact && <li>If approved: {results.constraints.gpa_impact}</li>}
          </ul>
        </details>
      )}
      <Suggestions run={run} />
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

// The Course Equivalency agents' evaluation (eligibility + rejection explanations), from the
// backend. The first evaluation starts automatically only when the backend reports it
// eligible (once); staff can re-evaluate when it is allowed. Everything is advisory.
function EvaluationPanel({ status, data, error, running, notice, canStartFirst, canRerun, onRun, onRetry }: EvaluationPanelProps) {
  const view = evaluationPanelView(status, data, running)
  const { current, failedAttempt } = view
  const lastEvaluated = formatDateTime(current?.finished_at)
  const rerunAllowed = canRerun && !view.finalized
  return (
    <section className="pcr-ai" aria-labelledby="cer-ai-title" aria-busy={view.stage === 'running'}>
      <div className="pcr-ai__head">
        <div className="pcr-ai__heading">
          <h2 id="cer-ai-title" className="pcr-ai__title">
            AI Agent Evaluation
          </h2>
          <span className="pcr-ai__agent">Course Equivalency Eligibility Agent · advisory</span>
        </div>
        {(current || failedAttempt) && (
          <div className="pcr-ai__tools">
            {lastEvaluated && <span className="pcr-ai__generated">Last evaluated {lastEvaluated}</span>}
            <button
              type="button"
              className="pcr-rerun"
              onClick={() => onRun(true)}
              disabled={!rerunAllowed}
              title={
                view.finalized
                  ? 'This request is no longer In Progress; it is not evaluated again.'
                  : view.stage === 'running'
                    ? 'An evaluation is running.'
                    : !rerunAllowed
                      ? 'Re-evaluation needs both syllabi and the request details.'
                      : undefined
              }
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
              </svg>
              {view.stage === 'running' ? 'Evaluating…' : 'Re-evaluate'}
            </button>
          </div>
        )}
      </div>

      {view.draftThresholds && (
        <p className="ier-authenticity" role="note">
          <span aria-hidden="true">ⓘ</span>
          <span>{draftThresholdsNotice(current?.deterministic_results?.similarity)}</span>
        </p>
      )}

      {view.stage === 'loading' && (
        <p className="pcr-state" role="status">
          Loading the saved evaluation…
        </p>
      )}
      {view.stage === 'error' && (
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
      {view.detailsMissing && (
        <p className="rv-notice pcr-notice" role="alert">
          {data?.details_missing_message ?? 'This request has no Course Equivalency details, so it cannot be evaluated.'}
        </p>
      )}
      {view.syllabiMissing && !view.detailsMissing && (
        <p className="rv-notice pcr-notice" role="status">
          {data?.syllabi_missing_message ?? 'Both syllabi are required before the eligibility check can run.'}
        </p>
      )}
      {view.stage === 'running' && (
        <div className="pcr-state" role="status" aria-live="polite">
          <span className="pcr-state__running">
            <span className="pcr-spinner" aria-hidden="true" />
            Evaluating eligibility…
          </span>
          <span className="pcr-state__body">
            {running
              ? 'The agent is reading both syllabi, comparing them and checking the academic rules. This can take a minute or two; keep this page open.'
              : 'An evaluation is already running for this request. This page updates when it finishes.'}
          </span>
        </div>
      )}
      {notice && (
        <p className="rv-notice pcr-notice" role="alert">
          {notice}
        </p>
      )}
      {current && view.outdated && view.stage !== 'running' && (
        <p className="pcr-warning cer-outdated" role="alert">
          <span aria-hidden="true">! </span>
          {outdatedMessage(view.outdatedSides)}
        </p>
      )}
      {view.preservedAfterFailure && failedAttempt && view.stage !== 'running' && (
        <p className="rv-notice pcr-notice" role="alert">
          The latest re-evaluation{formatDateTime(failedAttempt.finished_at) ? ` (${formatDateTime(failedAttempt.finished_at)})` : ''} did
          not complete: {failedAttempt.error_message ?? 'the evaluation did not finish.'}{' '}
          {FAILURE_NOTES[failedAttempt.failure_kind ?? 'technical'] ?? FAILURE_NOTES.technical} The result below is the last successful
          evaluation and has not been replaced.
        </p>
      )}
      {view.stage === 'failed' && failedAttempt && (
        <div className="pcr-state pcr-state--error" role="alert">
          <div className="pcr-state__text">
            <span className="pcr-state__title">! The evaluation couldn’t be completed</span>
            <span className="pcr-state__body">
              {failedAttempt.error_message ?? 'The evaluation did not finish.'}{' '}
              {FAILURE_NOTES[failedAttempt.failure_kind ?? 'technical'] ?? FAILURE_NOTES.technical} No recommendation was recorded.
            </span>
          </div>
          {rerunAllowed && (
            <button type="button" className="pcr-primary" onClick={() => onRun(true)}>
              Re-evaluate
            </button>
          )}
        </div>
      )}
      {view.stage === 'not_evaluated' && (
        <div className="pcr-state pcr-state--empty">
          <p className="pcr-state__body">
            {view.finalized
              ? 'No evaluation was recorded for this request. Evaluations run only while a request is In Progress.'
              : view.manualStartRequired
                ? LEGACY_MANUAL_START_NOTICE
                : 'This request has not been evaluated yet. The evaluation starts automatically once both syllabi are uploaded.'}
          </p>
          {canStartFirst && !view.finalized && (
            <button type="button" className="pcr-primary" onClick={() => onRun(false)}>
              Run Evaluation
            </button>
          )}
        </div>
      )}
      {current && <Results run={current} />}
    </section>
  )
}

export default EvaluationPanel

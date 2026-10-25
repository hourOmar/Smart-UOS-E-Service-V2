import { useState } from 'react'
import {
  readReport,
  type EligibilityCheck,
  type ProgramChangeEvaluationState,
  type ProgramChangeRecommendation,
  type ProgramChangeRun,
} from '../../services/programChangeReview'
import { formatDateTime } from '../review/format'
import { rerunAllowed } from '../../utils/programChangeDecision'

const RECOMMENDATIONS: Record<ProgramChangeRecommendation, { tone: string; glyph: string; label: string }> = {
  APPROVE: { tone: 'approve', glyph: '✓', label: 'APPROVE' },
  REJECT: { tone: 'reject', glyph: '✕', label: 'REJECT' },
  REQUIRES_REVIEW: { tone: 'review', glyph: '!', label: 'REQUIRES REVIEW' },
}

type CheckTone = 'pass' | 'fail' | 'unknown'

const CHECK_STATUS: Record<CheckTone, { glyph: string; label: string }> = {
  pass: { glyph: '✓', label: 'PASSED' },
  fail: { glyph: '✕', label: 'FAILED' },
  unknown: { glyph: '–', label: 'NOT RECORDED' },
}

const CONFLICT_WARNING =
  'The agent’s recommendation conflicts with the recorded academic eligibility checks. Administrator review is required.'

const toneOf = (check: EligibilityCheck | null | undefined): CheckTone =>
  check?.passed === true ? 'pass' : check?.passed === false ? 'fail' : 'unknown'

// Why a run failed, in words that match its failure_kind.
const FAILURE_NOTES: Record<string, string> = {
  data: 'The request’s academic data stopped the check; re-running will give the same result until the data is corrected.',
  technical: 'This is a technical failure, not a recommendation.',
  interrupted: 'The check did not finish. This is a technical failure, not a recommendation.',
}

interface EvaluationPanelProps {
  status: 'loading' | 'ready' | 'error'
  data: ProgramChangeEvaluationState | null
  error: string | null
  running: boolean
  notice: string | null
  onRun: (rerun: boolean) => void
  onRetry: () => void
  /** The request's current status from the database (null while loading).
   *  A decided request is never evaluated again. */
  requestStatus: string | null
}

const hasValue = (value: unknown) => value !== null && value !== undefined && value !== ''

function formatCgpa(value: number | string | null | undefined) {
  if (!hasValue(value)) return null
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(2) : String(value)
}

function CheckCard({
  name,
  value,
  minimum,
  tone,
  detail,
}: {
  name: string
  value: string | null
  minimum: string | null
  tone: CheckTone
  detail: string
}) {
  const status = CHECK_STATUS[tone]
  return (
    <div className="pcr-check" data-tone={tone}>
      <div className="pcr-check__head">
        <span className="pcr-check__name">{name}</span>
        <span className="pcr-check__status">
          <span aria-hidden="true">{status.glyph}</span>
          {status.label}
        </span>
      </div>
      <div className="pcr-check__figures">
        <span className="pcr-check__value">{value ?? '—'}</span>
        <span className="pcr-check__min">{minimum ? `/ min ${minimum}` : '/ min NOT RECORDED'}</span>
      </div>
      <span className="pcr-check__detail">{detail}</span>
    </div>
  )
}

function Results({ run, canRerun, onRerun }: { run: ProgramChangeRun; canRerun: boolean; onRerun: () => void }) {
  const [coursesOpen, setCoursesOpen] = useState(true)
  const eligibility = run.eligibility
  const report = readReport(run.report)
  const rec = run.recommendation ? RECOMMENDATIONS[run.recommendation] : null
  const courses = run.deterministic_results?.matched_courses ?? []

  const cgpa = eligibility?.cgpa ?? null
  const hours = eligibility?.applicable_hours ?? null
  const cgpaTone = toneOf(cgpa)
  const hoursTone = toneOf(hours)
  const hoursValue = hasValue(hours?.value) ? Number(hours?.value) : null
  const hoursGap =
    hoursTone === 'fail' && hoursValue !== null && typeof hours?.minimum === 'number' ? hours.minimum - hoursValue : null

  return (
    <>
      {eligibility?.recommendation_conflict && (
        <p className="pcr-conflict" role="alert">
          <span aria-hidden="true">! </span>
          {CONFLICT_WARNING}
        </p>
      )}
      {eligibility && !eligibility.recorded && (
        <div className="rv-notice pcr-notice pcr-legacy" role="note">
          <span>
            This evaluation predates structured eligibility results
            {run.agent_version ? ` (agent ${run.agent_version})` : ''}: its minimum requirements and applicable
            credit-hour result were not recorded and are shown as NOT RECORDED. The values it stored are shown
            unchanged.
            {canRerun ? ' Re-run the evaluation to record them.' : ''}
          </span>
          {canRerun && (
            <button type="button" className="pcr-rerun" onClick={onRerun}>
              Re-run Evaluation
            </button>
          )}
        </div>
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
        {report.summary ? (
          <p className="pcr-summary">{report.summary}</p>
        ) : (
          <>
            <p className="rv-muted">The agent’s report has no Overall Assessment section.</p>
            {run.report && (
              <details className="pcr-report">
                <summary>Show the agent’s full report</summary>
                <pre className="pcr-report__text">{run.report}</pre>
              </details>
            )}
          </>
        )}
        <span className="pcr-advisory">
          <span aria-hidden="true">ⓘ</span>
          Advisory only — the final decision belongs to the administrator.
        </span>
      </div>

      <div className="pcr-column">
        <span className="pcr-column__label">Academic eligibility checks</span>
        <CheckCard
          name="CGPA Requirement"
          value={formatCgpa(cgpa?.value)}
          minimum={typeof cgpa?.minimum === 'number' ? cgpa.minimum.toFixed(2) : null}
          tone={cgpaTone}
          detail={
            cgpaTone === 'pass'
              ? 'The student satisfies the minimum CGPA requirement.'
              : cgpaTone === 'fail'
                ? 'The student’s CGPA is below the minimum requirement.'
                : 'No CGPA result was recorded for this evaluation.'
          }
        />
        <CheckCard
          name="Applicable Credit Hours"
          value={hoursValue !== null ? String(hours?.value) : null}
          minimum={typeof hours?.minimum === 'number' ? String(hours.minimum) : null}
          tone={hoursTone}
          detail={
            hoursTone === 'pass'
              ? 'The student meets the minimum applicable credit-hour requirement.'
              : hoursTone === 'fail'
                ? hoursGap !== null && hoursGap > 0
                  ? `The student is ${hoursGap} applicable credit hour${hoursGap === 1 ? '' : 's'} below the minimum requirement.`
                  : 'The student is below the minimum applicable credit-hour requirement.'
                : 'No applicable credit-hour result was recorded for this evaluation.'
          }
        />
        <span className="pcr-total">
          Total completed credits:{' '}
          <strong>{hasValue(eligibility?.completed_hours) ? String(eligibility?.completed_hours) : '—'}</strong>
        </span>
      </div>

      <div className="pcr-column pcr-column--last">
        <div className="pcr-courses__head">
          <span className="pcr-column__label">Applicable courses ({courses.length})</span>
          <button
            type="button"
            className="pcr-link-button"
            onClick={() => setCoursesOpen((open) => !open)}
            aria-expanded={coursesOpen}
            aria-controls="pcr-courses"
          >
            {coursesOpen ? 'Collapse −' : 'Expand +'}
          </button>
        </div>
        <div id="pcr-courses" className="pcr-courses">
          <table className="pcr-courses__table">
            {coursesOpen && (
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Course Name</th>
                  <th scope="col" className="pcr-num">
                    <abbr title="Credit hours">Cr</abbr>
                  </th>
                </tr>
              </thead>
            )}
            <tbody>
              {coursesOpen &&
                (courses.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="pcr-courses__empty">
                      No completed course applies to the requested program.
                    </td>
                  </tr>
                ) : (
                  courses.map((course) => (
                    <tr key={course.course_id}>
                      <td className="pcr-courses__code">{course.course_id}</td>
                      <td>{course.course_name ?? '—'}</td>
                      <td className="pcr-num">{hasValue(course.credit_hours) ? course.credit_hours : '—'}</td>
                    </tr>
                  ))
                ))}
              <tr className="pcr-courses__total">
                <td colSpan={2}>Total applicable credits</td>
                <td className="pcr-num">{hoursValue !== null ? String(hours?.value) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {report.issues ? (
          <span role="note" className="pcr-issues">
            ! {report.issues}
          </span>
        ) : report.noIssues ? (
          <span className="pcr-no-issues">
            <span aria-hidden="true">✓</span> No additional issues reported
          </span>
        ) : (
          <span className="rv-muted">The agent’s report has no Issues / Conflicts section.</span>
        )}
      </div>
    </div>
    </>
  )
}

function FailedAttempt({
  run,
  canRetry,
  onRetry,
}: {
  run: ProgramChangeRun
  canRetry: boolean
  onRetry: () => void
}) {
  const when = formatDateTime(run.finished_at ?? run.started_at)
  return (
    <div className="pcr-state pcr-state--error" role="alert">
      <div className="pcr-state__text">
        <span className="pcr-state__title">
          ! Evaluation couldn’t be completed{when ? ` (${when})` : ''}
        </span>
        <span className="pcr-state__body">
          {run.error_message ?? 'The check did not finish.'}{' '}
          {FAILURE_NOTES[run.failure_kind ?? 'technical'] ?? FAILURE_NOTES.technical} No recommendation was
          recorded — you can retry or review the transcript manually.
        </span>
      </div>
      {canRetry && (
        <button type="button" className="pcr-primary" onClick={onRetry}>
          Retry evaluation
        </button>
      )}
    </div>
  )
}

// The Program Change Eligibility Agent's saved evaluation: running and error
// states, then recommendation, eligibility checks and applicable courses side
// by side. Everything shown comes from the stored run: the deterministic
// checks, or the text of the agent's report.
function EvaluationPanel({ status, data, error, running, notice, onRun, onRetry, requestStatus }: EvaluationPanelProps) {
  const active = running || Boolean(data?.in_progress)
  const current = data?.current ?? null
  const attempt = data?.latest_attempt ?? null
  const failed = attempt && (attempt.run_status === 'failed' || attempt.run_status === 'interrupted') ? attempt : null
  // Both the request's own status and the API must allow a re-run.
  const effectiveStatus = requestStatus ?? data?.request_status ?? null
  const finalized = effectiveStatus !== null && effectiveStatus !== 'In Progress'
  const canRerun = rerunAllowed(effectiveStatus, Boolean(data?.can_rerun), active) &&
    data?.request_status === 'In Progress'
  const lastEvaluated = formatDateTime(current?.finished_at)

  return (
    <section className="pcr-ai" aria-labelledby="pcr-ai-title" aria-busy={active}>
      <div className="pcr-ai__head">
        <div className="pcr-ai__heading">
          <h2 id="pcr-ai-title" className="pcr-ai__title">
            AI Agent Evaluation
          </h2>
          <span className="pcr-ai__agent">Program Change Eligibility Agent</span>
        </div>
        {current && (
          <div className="pcr-ai__tools">
            {lastEvaluated && <span className="pcr-ai__generated">Last evaluated {lastEvaluated}</span>}
            <button
              type="button"
              className="pcr-rerun"
              onClick={() => onRun(true)}
              disabled={!canRerun}
              title={
                finalized
                  ? 'This request has been decided; it is not evaluated again.'
                  : active
                    ? 'An evaluation is running.'
                    : !canRerun
                      ? 'Only In Progress requests can be evaluated again.'
                      : undefined
              }
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
              </svg>
              {active ? 'Evaluating…' : 'Re-run Evaluation'}
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

      {active && (
        <div className="pcr-state" role="status" aria-live="polite">
          <span className="pcr-state__running">
            <span className="pcr-spinner" aria-hidden="true" />
            Evaluating eligibility…
          </span>
          <span className="pcr-state__body">
            {running
              ? 'The agent is reading the transcript and the requested program’s study plan. This can take a minute or two.'
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
          The latest re-run{formatDateTime(failed.finished_at) ? ` (${formatDateTime(failed.finished_at)})` : ''} did
          not complete: {failed.error_message ?? 'the check did not finish.'} The result below is the last successful
          evaluation and has not been replaced.
        </p>
      )}

      {!current && failed && !active && (
        <FailedAttempt run={failed} canRetry={canRerun} onRetry={() => onRun(true)} />
      )}

      {status === 'ready' && data && !current && !failed && !active && (
        <div className="pcr-state pcr-state--empty">
          <p className="pcr-state__body">
            {finalized
              ? 'No evaluation was recorded for this request. Evaluations run only while a request is In Progress.'
              : 'Run the Program Change Eligibility Agent to check the student’s CGPA and applicable credit hours against the requested program. Results are recommendations — they don’t change the request status or notify the student.'}
          </p>
          {data.auto_run_eligible && !finalized && (
            <button type="button" className="pcr-primary" onClick={() => onRun(false)}>
              Run evaluation
            </button>
          )}
        </div>
      )}

      {current && <Results key={current.id} run={current} canRerun={canRerun} onRerun={() => onRun(true)} />}
    </section>
  )
}

export default EvaluationPanel

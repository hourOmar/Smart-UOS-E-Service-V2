import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CourseEquivalencyDecisionError, decideCourseEquivalencyRequest } from '../../services/courseEquivalencyReview'
import {
  ACADEMIC_RECORD_LIMITATION,
  EXPLANATION_FIELD_ID,
  MAX_EXPLANATION,
  UNKNOWN_DECISION_MESSAGE,
  explanationError,
  explanationLength,
  isOverride,
  type DecisionChoice,
  type DecisionReadiness,
} from '../../utils/courseEquivalencyDecision'
import { RECOMMENDATION_DISPLAY, type CourseEquivalencyRecommendation } from '../../utils/courseEquivalencyEvaluation'
import type { CourseEquivalencyReviewRecord } from '../../utils/courseEquivalencyRecord'
import { statusLabel } from '../../utils/statusLabels'
import { formatDateTime } from '../review/format'

const OPTIONS: { value: DecisionChoice; label: string; description: string }[] = [
  {
    value: 'approve',
    label: 'Approve',
    description:
      'Record an administrative approval. The student is notified and sees your explanation. The transcript is not changed.',
  },
  { value: 'reject', label: 'Reject', description: 'Decline the request. Explain why and any next steps.' },
]

const OUTCOME: Record<DecisionChoice, { tone: string; glyph: string; label: string }> = {
  approve: { tone: 'approve', glyph: '✓', label: 'Approved' },
  reject: { tone: 'reject', glyph: '✕', label: 'Rejected' },
}

interface DecisionPanelProps {
  record: CourseEquivalencyReviewRecord
  /** Whether a decision can be recorded now, and on which evaluation (decisionReadiness). */
  readiness: DecisionReadiness
  /** Reload the request, decision and evaluation (after a save or a refusal). */
  onChanged: () => void
}

function decider(staffId: number | null, staffName: string | null) {
  if (staffId == null) return 'Not recorded'
  return staffName ? `${staffName} (Staff ID ${staffId})` : `Staff ID ${staffId}`
}

function RecommendationBadge({ recommendation }: { recommendation: CourseEquivalencyRecommendation }) {
  const shown = RECOMMENDATION_DISPLAY[recommendation]
  return (
    <span className="pcr-verdict" data-tone={shown.tone}>
      <span aria-hidden="true">{shown.glyph}</span>
      {shown.label}
    </span>
  )
}

// A finalized request: the saved decision, read-only.
function RecordedDecision({ record }: { record: CourseEquivalencyReviewRecord }) {
  const d = record.decision
  if (d) {
    const outcome = OUTCOME[d.choice]
    return (
      <div className="pcr-recorded">
        <div className="pcr-recorded__head">
          <span className="pcr-recorded__label">Recorded decision</span>
          <span className="pcr-recorded__outcome" data-tone={outcome.tone}>
            <span aria-hidden="true">{outcome.glyph}</span>
            {outcome.label}
          </span>
        </div>
        <p className="pcr-recorded__note">{d.explanation}</p>
        <span className="pcr-recorded__meta">
          {decider(d.staffId, d.staffName)} · {formatDateTime(d.date) ?? 'Date not recorded'}
        </span>
        {d.choice === 'approve' && (
          <p className="cer-limitation" role="note">
            {ACADEMIC_RECORD_LIMITATION}
          </p>
        )}
      </div>
    )
  }
  // Finalized without a decision record (e.g. by another client changing the status directly).
  const h = record.history
  return (
    <div className="rv-alert" role="status">
      <p className="rv-alert__title">This request is {statusLabel(record.request.status, record.request.type)}.</p>
      <p className="rv-alert__body">
        No decision record exists for it, so no explanation is available.
        {h ? ` Finalized ${formatDateTime(h.date) ?? 'on an unrecorded date'} by ${decider(h.staffId, null)}.` : ''}
      </p>
    </div>
  )
}

// The administrator's final decision on a Course Equivalency request (same design as
// Course Substitution): outcome, explanation to the student, override confirmation when the
// outcome differs from the agent's recommendation, then an explicit confirmation step.
// Saved only through decide_course_equivalency_request, which identifies the staff member
// from the session and refuses unless the evaluation reviewed here is still the newest
// completed evaluation of the current syllabi. DECISION ONLY: the transcript is never changed.
function DecisionPanel({ record, readiness, onChanged }: DecisionPanelProps) {
  const [choice, setChoice] = useState<DecisionChoice | null>(null)
  const [explanation, setExplanation] = useState('')
  const [overrideConfirmed, setOverrideConfirmed] = useState(false)
  const [step, setStep] = useState<'form' | 'confirm'>('form')
  // The evaluation the administrator reviewed when moving to the confirmation step: sent
  // with the decision, so a newer result arriving meanwhile is refused (evaluation_changed).
  const [reviewedRunId, setReviewedRunId] = useState<number | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Guards against a second submission before React re-renders.
  const savingRef = useRef(false)

  const { request, student } = record
  const finalized = request.status !== 'In Progress'
  const recommendation = readiness.ready ? readiness.recommendation : null
  const override = isOverride(choice, recommendation)
  const length = explanationLength(explanation)
  const choiceError = attempted && !choice ? 'Choose Approve or Reject.' : null
  const noteError = explanationError(explanation, attempted)
  const overrideError =
    attempted && override && !overrideConfirmed ? 'Confirm that you are overriding the agent’s recommendation.' : null
  const studentName = student?.name ?? 'The student'

  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAttempted(true)
    setError(null)
    if (!readiness.ready || !choice || explanationError(explanation, true) !== null) return
    if (override && !overrideConfirmed) return
    setReviewedRunId(readiness.run.id)
    setStep('confirm')
  }

  const save = async () => {
    if (!choice || reviewedRunId == null || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await decideCourseEquivalencyRequest(request.id, choice, explanation, reviewedRunId, override && overrideConfirmed)
      setNotice(
        // The decision record was just saved, so an approval reads "Approved".
        `Decision saved: ${statusLabel(result.status || (choice === 'approve' ? 'Completed' : 'Rejected'), request.type, choice === 'approve')}` +
          `${result.override ? ' (override of the agent’s recommendation)' : ''}. ${studentName} has been notified.` +
          (choice === 'approve' ? ' The transcript was not changed.' : ''),
      )
    } catch (caught) {
      setError(caught instanceof CourseEquivalencyDecisionError ? caught.message : UNKNOWN_DECISION_MESSAGE)
      setStep('form')
    } finally {
      savingRef.current = false
      setSaving(false)
      // Show the real state either way: the saved decision, or the request still In
      // Progress (with a possibly newer evaluation) after a refusal.
      onChanged()
    }
  }

  return (
    <section className="pcr-decision cer-decision" aria-labelledby="cer-decision-title">
      <div className="pcr-decision__head">
        <h2 id="cer-decision-title" className="pcr-decision__title">
          Administrator decision
        </h2>
        <span className="pcr-decision__sub">Final · recorded under your name</span>
      </div>

      <div className="pcr-decision__body">
        {notice && (
          <p className="rv-saved" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="rv-notice" role="alert">
            {error}
          </p>
        )}

        {finalized ? (
          <RecordedDecision record={record} />
        ) : !record.details ? (
          <p className="rv-notice" role="alert">
            This request has no Course Equivalency details (old and new course), so it cannot be decided here.
          </p>
        ) : !readiness.ready ? (
          readiness.message ? (
            <p className="pcr-warning" role="note">
              <span aria-hidden="true">! </span>
              {readiness.message}
            </p>
          ) : (
            <p className="rv-muted" role="status">
              Loading the agent evaluation…
            </p>
          )
        ) : step === 'form' ? (
          <form className="pcr-decision__fields" onSubmit={review} noValidate>
            <div className="cer-agent">
              <span className="pcr-decision__label">Agent recommendation (advisory)</span>
              <span className="cer-agent__line">
                <RecommendationBadge recommendation={readiness.recommendation} />
                <span className="rv-muted">
                  Evaluation #{readiness.run.id}
                  {readiness.run.finished_at ? ` · ${formatDateTime(readiness.run.finished_at)}` : ''} · current syllabi
                </span>
              </span>
              <span className="rv-muted">{RECOMMENDATION_DISPLAY[readiness.recommendation].meaning}</span>
            </div>

            <p className="cer-limitation" role="note">
              {ACADEMIC_RECORD_LIMITATION}
            </p>

            <fieldset className="pcr-outcome" aria-describedby={choiceError ? 'cer-outcome-error' : undefined}>
              <legend className="pcr-decision__label">
                Outcome <span className="pcr-required" aria-hidden="true">*</span>
                <span className="student-visually-hidden">(required)</span>
              </legend>
              <div className="pcr-outcome__options">
                {OPTIONS.map((option) => (
                  <label key={option.value} className="pcr-outcome__option" data-checked={choice === option.value}>
                    <input
                      type="radio"
                      name="cer-outcome"
                      value={option.value}
                      checked={choice === option.value}
                      onChange={() => {
                        setChoice(option.value)
                        setOverrideConfirmed(false)
                        setError(null)
                      }}
                    />
                    <span className="pcr-outcome__text">
                      <span className="pcr-outcome__label">{option.label}</span>
                      <span className="pcr-outcome__desc">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              {choiceError && (
                <span id="cer-outcome-error" className="rv-field-error">
                  ✕ {choiceError}
                </span>
              )}
            </fieldset>

            {override && (
              <div className="pcr-disagree" role="note">
                <p className="cer-override__text">
                  Your decision differs from the agent’s recommendation ({RECOMMENDATION_DISPLAY[readiness.recommendation].label}).
                  That is allowed, but it is recorded as an override. Explain your reasons to the student.
                </p>
                <label className="cer-override__confirm">
                  <input
                    type="checkbox"
                    checked={overrideConfirmed}
                    onChange={(event) => {
                      setOverrideConfirmed(event.target.checked)
                      setError(null)
                    }}
                    aria-invalid={overrideError ? true : undefined}
                    aria-describedby={overrideError ? 'cer-override-error' : undefined}
                  />
                  <span>I confirm that I am overriding the agent’s recommendation.</span>
                </label>
                {overrideError && (
                  <span id="cer-override-error" className="rv-field-error">
                    ✕ {overrideError}
                  </span>
                )}
              </div>
            )}
            {choice && readiness.recommendation === 'MANUAL_REVIEW' && (
              <p className="rv-muted" role="note">
                The agent did not recommend an outcome (manual review), so either decision is yours to make.
              </p>
            )}

            <div className="pcr-note">
              <label htmlFor={EXPLANATION_FIELD_ID} className="pcr-decision__label">
                Explanation to student <span className="pcr-required" aria-hidden="true">*</span>
                <span className="student-visually-hidden">(required)</span>
              </label>
              <textarea
                id={EXPLANATION_FIELD_ID}
                className="pcr-note__input"
                rows={5}
                value={explanation}
                onChange={(event) => {
                  setExplanation(event.target.value)
                  setError(null)
                }}
                placeholder="Explain the outcome in plain language. The student will see this."
                aria-invalid={noteError ? true : undefined}
                aria-describedby="cer-note-hint"
              />
              <span id="cer-note-hint" className={noteError ? 'rv-field-error' : 'pcr-note__hint'}>
                {noteError
                  ? `✕ ${noteError}`
                  : `${length.toLocaleString('en-US')} / ${MAX_EXPLANATION.toLocaleString('en-US')} characters. Shown to the student with the outcome.`}
              </span>
            </div>

            <div className="pcr-decision__actions">
              <button type="submit" className="pcr-submit">
                Submit Final Decision
              </button>
              <span className="rv-muted">Nothing is saved until you confirm on the next step.</span>
            </div>
          </form>
        ) : (
          <div className="pcr-confirm" role="alertdialog" aria-labelledby="cer-confirm-title" aria-describedby="cer-confirm-body">
            <strong id="cer-confirm-title" className="pcr-confirm__title">
              {choice === 'approve' ? 'Approve' : 'Reject'} {request.id}?
            </strong>
            <p id="cer-confirm-body" className="pcr-confirm__body">
              This is your final administrative decision and cannot be changed afterwards. The status will change to{' '}
              {choice === 'approve' ? 'Approved' : 'Rejected'} and {studentName} will be notified and will see your
              explanation.
              {override ? ' It will be recorded as an override of the agent’s recommendation.' : ''}
              {choice === 'approve'
                ? ' No transcript entry, credit hours, CGPA, completed hours or program change is made.'
                : ''}
            </p>
            <div className="pcr-confirm__explanation">
              <span className="req-text__label">Explanation to student</span>
              <p className="req-text__body">{explanation.trim()}</p>
            </div>
            <div className="pcr-decision__actions">
              <button
                type="button"
                className="pcr-submit"
                onClick={() => void save()}
                disabled={saving}
                aria-busy={saving || undefined}
              >
                {saving ? 'Saving…' : choice === 'approve' ? 'Confirm approval' : 'Confirm rejection'}
              </button>
              <button type="button" className="req-button" onClick={() => setStep('form')} disabled={saving}>
                Go back
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export default DecisionPanel

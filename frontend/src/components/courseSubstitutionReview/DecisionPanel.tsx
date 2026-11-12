import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CourseSubstitutionDecisionError, decideCourseSubstitutionRequest } from '../../services/courseSubstitutionReview'
import {
  EXPLANATION_FIELD_ID,
  MAX_EXPLANATION,
  UNKNOWN_DECISION_MESSAGE,
  differsFromRecommendation,
  evaluationWarning,
  explanationError,
  explanationLength,
  type DecisionChoice,
  type CourseSubstitutionEvaluationSummary,
} from '../../utils/courseSubstitutionDecision'
import type { CourseSubstitutionResult } from '../../utils/courseSubstitutionEvaluation'
import type { CourseSubstitutionReviewRecord } from '../../utils/courseSubstitutionRecord'
import { statusLabel } from '../../utils/statusLabels'
import { formatDateTime } from '../review/format'

const OPTIONS: { value: DecisionChoice; label: string; description: string }[] = [
  {
    value: 'approve',
    label: 'Approve',
    description: 'Approve the Course Substitution request. The student is notified and sees your explanation.',
  },
  { value: 'reject', label: 'Reject', description: 'Decline the request. Explain why and any next steps.' },
]

const OUTCOME: Record<DecisionChoice, { tone: string; glyph: string; label: string }> = {
  approve: { tone: 'approve', glyph: '✓', label: 'Approved' },
  reject: { tone: 'reject', glyph: '✕', label: 'Rejected' },
}

const RESULT_LABELS: Record<CourseSubstitutionResult, string> = {
  ELIGIBLE: 'ELIGIBLE',
  NOT_ELIGIBLE: 'NOT ELIGIBLE',
  MANUAL_REVIEW: 'MANUAL REVIEW',
}

interface DecisionPanelProps {
  record: CourseSubstitutionReviewRecord
  /** The newest completed evaluation's overall result (advisory), if any. */
  result: CourseSubstitutionResult | null
  evaluation: CourseSubstitutionEvaluationSummary
  /** The explanation to the student (held by the page, so a suggested reason can fill it). */
  explanation: string
  onExplanationChange: (value: string) => void
  /** Tells the page whether the form is being edited (suggestions may fill it) or confirmed. */
  onStepChange: (step: 'form' | 'confirm') => void
  /** Reload the request, decision and evaluation (after a save or a refusal). */
  onChanged: () => void
}

function decider(staffId: number | null, staffName: string | null) {
  if (staffId == null) return 'Not recorded'
  return staffName ? `${staffName} (Staff ID ${staffId})` : `Staff ID ${staffId}`
}

// A finalized request: the saved decision, read-only.
function RecordedDecision({ record }: { record: CourseSubstitutionReviewRecord }) {
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
      </div>
    )
  }
  // Finalized without a decision record (e.g. before decisions were recorded).
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

// The administrator's final decision on a Course Substitution request (same
// design as Incomplete Exam): outcome, explanation to the student, then an
// explicit confirmation. Saved only through decide_course_substitution_request,
// which identifies the staff member from the session. The agent's
// result and suggested reasons are advisory: the administrator may
// decide differently and must write (or edit) the explanation.
function DecisionPanel({
  record,
  result: advisoryResult,
  evaluation,
  explanation,
  onExplanationChange,
  onStepChange,
  onChanged,
}: DecisionPanelProps) {
  const [choice, setChoice] = useState<DecisionChoice | null>(null)
  const [step, setStep] = useState<'form' | 'confirm'>('form')
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Guards against a second submission before React re-renders.
  const savingRef = useRef(false)

  const { request, student } = record
  const finalized = request.status !== 'In Progress'
  const length = explanationLength(explanation)
  const choiceError = attempted && !choice ? 'Choose Approve or Reject.' : null
  const noteError = explanationError(explanation, attempted)
  const warning = evaluationWarning(evaluation)
  const disagrees = differsFromRecommendation(choice, advisoryResult)
  const studentName = student?.name ?? 'The student'

  const goTo = (next: 'form' | 'confirm') => {
    setStep(next)
    onStepChange(next)
  }

  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAttempted(true)
    setError(null)
    if (!choice || explanationError(explanation, true) !== null) return
    goTo('confirm')
  }

  const save = async () => {
    if (!choice || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await decideCourseSubstitutionRequest(request.id, choice, explanation)
      setNotice(
        // The decision record was just saved, so an approval reads "Approved".
        `Decision saved: ${statusLabel(result.status || (choice === 'approve' ? 'Completed' : 'Rejected'), request.type, choice === 'approve')}. ` +
          `${studentName} has been notified.`,
      )
    } catch (caught) {
      setError(caught instanceof CourseSubstitutionDecisionError ? caught.message : UNKNOWN_DECISION_MESSAGE)
      goTo('form')
    } finally {
      savingRef.current = false
      setSaving(false)
      // Show the real state either way: the saved decision, or the request
      // still In Progress after a refusal.
      onChanged()
    }
  }

  return (
    <section className="pcr-decision" aria-labelledby="csr-decision-title">
      <div className="pcr-decision__head">
        <h2 id="csr-decision-title" className="pcr-decision__title">
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
        ) : !request.details ? (
          <p className="rv-notice" role="alert">
            This request has no Course Substitution details (original and proposed course), so it cannot be decided here.
          </p>
        ) : step === 'form' ? (
          <form className="pcr-decision__fields" onSubmit={review} noValidate>
            {warning && (
              <p className="pcr-warning" role="note">
                <span aria-hidden="true">! </span>
                {warning}
              </p>
            )}

            <fieldset className="pcr-outcome" aria-describedby={choiceError ? 'csr-outcome-error' : undefined}>
              <legend className="pcr-decision__label">
                Outcome <span className="pcr-required" aria-hidden="true">*</span>
                <span className="student-visually-hidden">(required)</span>
              </legend>
              <div className="pcr-outcome__options">
                {OPTIONS.map((option) => (
                  <label key={option.value} className="pcr-outcome__option" data-checked={choice === option.value}>
                    <input
                      type="radio"
                      name="csr-outcome"
                      value={option.value}
                      checked={choice === option.value}
                      onChange={() => {
                        setChoice(option.value)
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
                <span id="csr-outcome-error" className="rv-field-error">
                  ✕ {choiceError}
                </span>
              )}
            </fieldset>

            {disagrees && advisoryResult && (
              <p className="pcr-disagree" role="note">
                Your decision differs from the agent’s advisory result ({RESULT_LABELS[advisoryResult]}).
                That is allowed: explain your reasons to the student.
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
                  onExplanationChange(event.target.value)
                  setError(null)
                }}
                placeholder="Explain the outcome in plain language. The student will see this."
                aria-invalid={noteError ? true : undefined}
                aria-describedby="csr-note-hint"
              />
              <span id="csr-note-hint" className={noteError ? 'rv-field-error' : 'pcr-note__hint'}>
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
          <div className="pcr-confirm" role="alertdialog" aria-labelledby="csr-confirm-title" aria-describedby="csr-confirm-body">
            <strong id="csr-confirm-title" className="pcr-confirm__title">
              {choice === 'approve' ? 'Approve' : 'Reject'} {request.id}?
            </strong>
            <p id="csr-confirm-body" className="pcr-confirm__body">
              This is your final administrative decision and cannot be changed afterwards. The status will change to{' '}
              {choice === 'approve' ? 'Approved' : 'Rejected'} and {studentName} will be notified and will see your
              explanation. The AI result is not applied automatically.
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
              <button type="button" className="req-button" onClick={() => goTo('form')} disabled={saving}>
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

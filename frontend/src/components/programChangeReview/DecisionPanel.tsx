import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ProgramChangeDecisionError,
  decideProgramChangeRequest,
  type ProgramChangeReviewRecord,
} from '../../services/programChangeReview'
import {
  MAX_EXPLANATION,
  UNKNOWN_DECISION_MESSAGE,
  differsFromRecommendation,
  evaluationWarning,
  explanationError,
  explanationLength,
  type AgentRecommendation,
  type DecisionChoice,
  type EvaluationSummary,
} from '../../utils/programChangeDecision'
import { statusLabel } from '../../utils/statusLabels'
import { formatDateTime } from '../review/format'

const OPTIONS: { value: DecisionChoice; label: string; description: string }[] = [
  {
    value: 'approve',
    label: 'Approve',
    description:
      'Approve the request. Any change to the student’s program is processed separately by the Registrar’s Office.',
  },
  { value: 'reject', label: 'Reject', description: 'Decline the request. Explain why and any next steps.' },
]

const OUTCOME: Record<DecisionChoice, { tone: string; glyph: string; label: string }> = {
  approve: { tone: 'approve', glyph: '✓', label: 'Approved' },
  reject: { tone: 'reject', glyph: '✕', label: 'Rejected' },
}

const RECOMMENDATION_LABELS: Record<AgentRecommendation, string> = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  REQUIRES_REVIEW: 'REQUIRES REVIEW',
}

interface DecisionPanelProps {
  record: ProgramChangeReviewRecord
  /** The newest completed evaluation's recommendation (advisory), if any. */
  recommendation: AgentRecommendation | null
  evaluation: EvaluationSummary
  /** Reload the request, decision and evaluation (after a save or a refusal). */
  onChanged: () => void
}

function decider(staffId: number | null, staffName: string | null) {
  if (staffId == null) return 'Not recorded'
  return staffName ? `${staffName} (Staff ID ${staffId})` : `Staff ID ${staffId}`
}

// A finalized request: the saved decision, read-only.
function RecordedDecision({ record }: { record: ProgramChangeReviewRecord }) {
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
      <p className="rv-alert__title">
        This request is {statusLabel(record.request.status, record.request.type)}.
      </p>
      <p className="rv-alert__body">
        No decision record exists for it, so no explanation is available.
        {h ? ` Finalized ${formatDateTime(h.date) ?? 'on an unrecorded date'} by ${decider(h.staffId, null)}.` : ''}
      </p>
    </div>
  )
}

// The administrator's final decision on a Program Change request, following
// the approved design: outcome, explanation to the student, then an explicit
// confirmation. Saved only through decide_program_change_request, which
// identifies the staff member from the session. The agent's recommendation is
// advisory: the administrator may decide differently.
function DecisionPanel({ record, recommendation, evaluation, onChanged }: DecisionPanelProps) {
  const [choice, setChoice] = useState<DecisionChoice | null>(null)
  const [explanation, setExplanation] = useState('')
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
  const disagrees = differsFromRecommendation(choice, recommendation)
  const studentName = student?.name ?? 'The student'

  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAttempted(true)
    setError(null)
    if (!choice || explanationError(explanation, true) !== null) return
    setStep('confirm')
  }

  const save = async () => {
    if (!choice || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await decideProgramChangeRequest(request.id, choice, explanation)
      setNotice(
        `Decision saved: ${statusLabel(result.status || (choice === 'approve' ? 'Completed' : 'Rejected'), request.type)}. ` +
          `${studentName} has been notified.`,
      )
    } catch (caught) {
      setError(caught instanceof ProgramChangeDecisionError ? caught.message : UNKNOWN_DECISION_MESSAGE)
      setStep('form')
    } finally {
      savingRef.current = false
      setSaving(false)
      // Show the real state either way: the saved decision, or the request
      // still In Progress after a refusal.
      onChanged()
    }
  }

  return (
    <section className="pcr-decision" aria-labelledby="pcr-decision-title">
      <div className="pcr-decision__head">
        <h2 id="pcr-decision-title" className="pcr-decision__title">
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
            This request has no Program Change details, so it cannot be decided.
          </p>
        ) : step === 'form' ? (
          <form className="pcr-decision__fields" onSubmit={review} noValidate>
            {warning && (
              <p className="pcr-warning" role="note">
                <span aria-hidden="true">! </span>
                {warning}
              </p>
            )}

            <fieldset className="pcr-outcome" aria-describedby={choiceError ? 'pcr-outcome-error' : undefined}>
              <legend className="pcr-decision__label">
                Outcome <span className="pcr-required" aria-hidden="true">*</span>
                <span className="student-visually-hidden">(required)</span>
              </legend>
              <div className="pcr-outcome__options">
                {OPTIONS.map((option) => (
                  <label key={option.value} className="pcr-outcome__option" data-checked={choice === option.value}>
                    <input
                      type="radio"
                      name="pcr-outcome"
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
                <span id="pcr-outcome-error" className="rv-field-error">
                  ✕ {choiceError}
                </span>
              )}
            </fieldset>

            {disagrees && recommendation && (
              <p className="pcr-disagree" role="note">
                Your decision differs from the agent’s advisory recommendation (
                {RECOMMENDATION_LABELS[recommendation]}). That is allowed: explain your reasons to the student.
              </p>
            )}

            <div className="pcr-note">
              <label htmlFor="pcr-note" className="pcr-decision__label">
                Explanation to student <span className="pcr-required" aria-hidden="true">*</span>
                <span className="student-visually-hidden">(required)</span>
              </label>
              <textarea
                id="pcr-note"
                className="pcr-note__input"
                rows={5}
                value={explanation}
                onChange={(event) => {
                  setExplanation(event.target.value)
                  setError(null)
                }}
                placeholder="Explain the outcome in plain language. The student will see this."
                aria-invalid={noteError ? true : undefined}
                aria-describedby="pcr-note-hint"
              />
              <span id="pcr-note-hint" className={noteError ? 'rv-field-error' : 'pcr-note__hint'}>
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
          <div className="pcr-confirm" role="alertdialog" aria-labelledby="pcr-confirm-title" aria-describedby="pcr-confirm-body">
            <strong id="pcr-confirm-title" className="pcr-confirm__title">
              {choice === 'approve' ? 'Approve' : 'Reject'} {request.id}?
            </strong>
            <p id="pcr-confirm-body" className="pcr-confirm__body">
              This is your final administrative decision and cannot be changed afterwards. The status will
              change to {choice === 'approve' ? 'Approved' : 'Rejected'} and {studentName} will be notified and
              will see your explanation. AI recommendations are not applied automatically.
              {choice === 'approve'
                ? ' Approval does not change the student’s program in the system; the Registrar’s Office processes the transfer separately.'
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

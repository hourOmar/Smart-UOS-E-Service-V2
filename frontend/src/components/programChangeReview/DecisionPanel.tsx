import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ProgramChangeDecisionError,
  decideProgramChangeRequest,
  type ProgramChangeReviewRecord,
} from '../../services/programChangeReview'
import {
  UNKNOWN_DECISION_MESSAGE,
  differsFromRecommendation,
  evaluationWarning,
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
  { value: 'reject', label: 'Reject', description: 'Decline the request.' },
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
        No decision record exists for it.
        {h ? ` Finalized ${formatDateTime(h.date) ?? 'on an unrecorded date'} by ${decider(h.staffId, null)}.` : ''}
      </p>
    </div>
  )
}

// The administrator's final decision on a Program Change request: Approve or
// Reject (no explanation), then an explicit confirmation. Saved only through
// decide_program_change_request, which identifies the staff member from the
// session. The agent's recommendation is
// advisory: the administrator may decide differently.
function DecisionPanel({ record, recommendation, evaluation, onChanged }: DecisionPanelProps) {
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
  const choiceError = attempted && !choice ? 'Choose Approve or Reject.' : null
  const warning = evaluationWarning(evaluation)
  const disagrees = differsFromRecommendation(choice, recommendation)
  const studentName = student?.name ?? 'The student'

  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAttempted(true)
    setError(null)
    if (!choice) return
    setStep('confirm')
  }

  const save = async () => {
    if (!choice || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await decideProgramChangeRequest(request.id, choice)
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
                {RECOMMENDATION_LABELS[recommendation]}). That is allowed: the recommendation is advisory.
              </p>
            )}

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
              change to {choice === 'approve' ? 'Approved' : 'Rejected'} and {studentName} will be notified. AI
              recommendations are not applied automatically.
              {choice === 'approve'
                ? ' Approval does not change the student’s program in the system; the Registrar’s Office processes the transfer separately.'
                : ''}
            </p>
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

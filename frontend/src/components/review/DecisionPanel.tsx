import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  DecisionError,
  decideRaiseCapacityRequest,
  type DecisionChoice,
  type ReviewRecord,
} from '../../services/raiseCapacityReview'
import { formatDateTime } from './format'
import { statusLabel } from '../../utils/statusLabels'

const MAX_EXPLANATION = 2000

// Characters as the database counts them (code points, after trimming).
const explanationLength = (value: string) => [...value.trim()].length

const OUTCOME: Record<DecisionChoice, { tone: string; glyph: string; label: string }> = {
  approve: { tone: 'approve', glyph: '✓', label: 'Approved' },
  reject: { tone: 'reject', glyph: '✕', label: 'Rejected' },
}

interface DecisionPanelProps {
  record: ReviewRecord
  /** Reload status and saved decision (after a save or a refusal). */
  onChanged: () => void
}

function decider(staffId: number | null, staffName: string | null) {
  if (staffId == null) return 'Not recorded'
  return staffName ? `${staffName} (Staff ID ${staffId})` : `Staff ID ${staffId}`
}

// A finalized request: the saved decision, read-only.
function FinalDecision({ record, notice }: { record: ReviewRecord; notice: string | null }) {
  const d = record.decision
  if (d) {
    const outcome = OUTCOME[d.choice]
    return (
      <>
        {notice && <p className="rv-saved" role="status">{notice}</p>}
        <div className="rv-rec" data-tone={outcome.tone}>
          <div className="rv-rec__head">
            <span aria-hidden="true">{outcome.glyph}</span>
            <span className="rv-rec__label">{outcome.label} by staff</span>
          </div>
          <div className="rv-rec__body">
            <dl className="rv-explain">
              <div className="rv-explain__item">
                <dt>Explanation</dt>
                <dd className="rv-decision__explanation">{d.explanation}</dd>
              </div>
              <div className="rv-explain__item">
                <dt>Decided by</dt>
                <dd>{decider(d.staffId, d.staffName)}</dd>
              </div>
              <div className="rv-explain__item">
                <dt>Date</dt>
                <dd>{formatDateTime(d.date) ?? 'Not recorded'}</dd>
              </div>
            </dl>
          </div>
        </div>
      </>
    )
  }
  // Finalized without a decision record (e.g. before decisions were recorded).
  const h = record.history
  return (
    <div className="rv-alert" role="status">
      <p className="rv-alert__title">This request is {statusLabel(record.request.status, record.request.type)}.</p>
      <p className="rv-alert__body">
        No decision record exists for it, so no explanation is available; it was finalized before
        decisions were recorded with an explanation.
        {h ? ` Finalized ${formatDateTime(h.date) ?? 'on an unrecorded date'} by ${decider(h.staffId, null)}.` : ''}
      </p>
    </div>
  )
}

function DecisionPanel({ record, onChanged }: DecisionPanelProps) {
  const [choice, setChoice] = useState<DecisionChoice | null>(null)
  const [explanation, setExplanation] = useState('')
  const [step, setStep] = useState<'form' | 'confirm'>('form')
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const savingRef = useRef(false)

  const { request } = record
  const details = request.details
  const finalized = request.status !== 'In Progress'
  const length = explanationLength(explanation)
  const choiceError = attempted && !choice ? 'Choose Approve or Reject.' : null
  const explanationError =
    attempted && length === 0
      ? 'Enter an explanation for the decision.'
      : length > MAX_EXPLANATION
        ? `The explanation can be at most ${MAX_EXPLANATION.toLocaleString('en-US')} characters.`
        : null

  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAttempted(true)
    setError(null)
    if (!choice || length === 0 || length > MAX_EXPLANATION) return
    setStep('confirm')
  }

  const save = async () => {
    if (!choice || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await decideRaiseCapacityRequest(request.id, choice, explanation.trim())
      setNotice(
        choice === 'approve'
          ? `Decision saved: approved.${result.currentCapacity != null ? ` The section now has ${result.currentCapacity} seats allocated.` : ''}`
          : 'Decision saved: rejected. The section was not changed.',
      )
    } catch (caught) {
      setError(caught instanceof DecisionError ? caught.message : 'The decision could not be saved.')
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
    <section className="req-panel rv-panel rv-decision" aria-labelledby="rv-decision-title">
      <h2 id="rv-decision-title" className="req-panel__title">
        Staff decision
      </h2>
      <div className="req-panel__body">
        {error && (
          <p className="rv-notice rv-decision__error" role="alert">
            {error}
          </p>
        )}

        {finalized ? (
          <FinalDecision record={record} notice={notice} />
        ) : !details ? (
          <p className="rv-notice" role="alert">
            This request has no Raise Capacity details, so it cannot be decided.
          </p>
        ) : (
          <>
            <p className="rv-advisory-note">
              Your decision is final. The eligibility recommendation above is advisory; you may decide
              differently.
            </p>

            {step === 'form' ? (
              <form className="rv-decision__form" onSubmit={review} noValidate>
                <fieldset className="rv-decision__choices">
                  <legend className="rv-decision__legend">Decision</legend>
                  {(['approve', 'reject'] as const).map((value) => (
                    <label key={value} className="rv-decision__option">
                      <input
                        type="radio"
                        name="rv-decision"
                        value={value}
                        checked={choice === value}
                        onChange={() => setChoice(value)}
                        aria-describedby={choiceError ? 'rv-choice-error' : undefined}
                      />
                      {value === 'approve' ? 'Approve request' : 'Reject request'}
                    </label>
                  ))}
                  {choiceError && (
                    <p id="rv-choice-error" className="rv-field-error">
                      {choiceError}
                    </p>
                  )}
                </fieldset>

                <label className="rv-decision__note" htmlFor="rv-explanation">
                  <span>Explanation (required)</span>
                </label>
                <textarea
                  id="rv-explanation"
                  className="rv-decision__textarea"
                  rows={4}
                  value={explanation}
                  onChange={(event) => setExplanation(event.target.value)}
                  aria-invalid={Boolean(explanationError)}
                  aria-describedby="rv-explanation-help"
                />
                <p id="rv-explanation-help" className={explanationError ? 'rv-field-error' : 'rv-muted'}>
                  {explanationError ??
                    `${length.toLocaleString('en-US')} / ${MAX_EXPLANATION.toLocaleString('en-US')} characters. Saved with the decision. For a rejection, the student sees it as the reason for rejection.`}
                </p>

                <div className="rv-decision__actions">
                  <button type="submit" className="rv-decision__save">
                    Submit decision
                  </button>
                  <span className="rv-muted">Nothing is saved until you confirm on the next step.</span>
                </div>
              </form>
            ) : (
              <div className="rv-confirm" role="group" aria-labelledby="rv-confirm-title">
                <p id="rv-confirm-title" className="rv-confirm__title">
                  {choice === 'approve' ? 'Approve' : 'Reject'} request {request.id}?
                </p>
                <p className="rv-confirm__notice">
                  Not saved yet. Only “Confirm {choice === 'approve' ? 'approval' : 'rejection'}” saves this as the
                  final decision.
                </p>
                <p className="rv-confirm__body">
                  {choice === 'approve'
                    ? `This allocates one seat in section ${details.sectionId} of ${details.courseId} (term ${details.term}): the section's seat count increases by 1 if a seat remains. It does not register the student.`
                    : 'The section is not changed.'}{' '}
                  The request becomes {choice === 'approve' ? 'Approved' : 'Rejected'}, the student is
                  notified{choice === 'reject' ? ' and sees your explanation as the reason' : ''}, and the
                  decision cannot be changed afterwards.
                </p>
                <div className="rv-confirm__explanation">
                  <span className="req-text__label">Explanation</span>
                  <p className="req-text__body">{explanation.trim()}</p>
                </div>
                <div className="rv-decision__actions">
                  <button type="button" className="rv-decision__save" onClick={() => void save()} disabled={saving}>
                    {saving ? 'Saving…' : `Confirm ${choice === 'approve' ? 'approval' : 'rejection'}`}
                  </button>
                  <button type="button" className="req-button rv-decision__back" onClick={() => setStep('form')} disabled={saving}>
                    Back to edit
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

export default DecisionPanel

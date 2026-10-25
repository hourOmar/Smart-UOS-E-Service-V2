import { REASON_MAX_LENGTH, type Program } from '../../services/programChange'

interface ProgramChangeDetailsProps {
  selected: Program | null
  currentProgramName: string | null
  reason: string
  onReasonChange: (value: string) => void
  onReasonBlur: () => void
  /** Shown once the student has left the field. */
  error: string | null
  onCancel: () => void
  /** A program is selected and the reason is valid. */
  canSubmit: boolean
  submitting: boolean
  /** Why the last submission was refused. */
  submitError: string | null
}

// Request Details: the chosen program, the required reason, and the actions.
// Submit Request is enabled only for a complete request, and not while one
// is being submitted.
function ProgramChangeDetails({
  selected,
  currentProgramName,
  reason,
  onReasonChange,
  onReasonBlur,
  error,
  onCancel,
  canSubmit,
  submitting,
  submitError,
}: ProgramChangeDetailsProps) {
  const describedBy = ['pc-reason-count', error ? 'pc-reason-error' : ''].filter(Boolean).join(' ')

  return (
    <section className="pc-details" aria-labelledby="pc-details-title">
      <div className="pc-details__head">
        <span className="pc-details__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 3.5h7l4.5 4.5v12.5H7zM14 3.5V8h4.5M10 13h5.5M10 16.5h4" />
          </svg>
        </span>
        <div className="pc-details__heading">
          <h2 id="pc-details-title" className="pc-details__title">Request Details</h2>
          <span className="pc-details__sub">Explain why you want to change program.</span>
        </div>
      </div>

      {selected ? (
        <div className="pc-target" aria-live="polite">
          <div className="pc-target__info">
            <span className="pc-target__label">Selected target program</span>
            <span className="pc-target__name">{selected.programName}</span>
            <span className="pc-target__college">{selected.collegeName}</span>
          </div>
          {currentProgramName && <span className="pc-target__from">From {currentProgramName}</span>}
        </div>
      ) : (
        <div className="pc-target pc-target--empty">Select a program above to continue.</div>
      )}

      <div className="rc-field">
        <label htmlFor="pc-reason" className="rc-field__label">
          Reason for program change{' '}
          <span className="rc-field__required" aria-hidden="true">*</span>
          <span className="student-visually-hidden">(required)</span>
        </label>
        <textarea
          id="pc-reason"
          className="rc-field__input"
          rows={5}
          maxLength={REASON_MAX_LENGTH}
          required
          placeholder="Explain why you want to change program."
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          onBlur={onReasonBlur}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        <div className="pc-field__foot">
          {error && (
            <span id="pc-reason-error" className="rc-error">
              <span aria-hidden="true">✕ </span>
              {error}
            </span>
          )}
          <span id="pc-reason-count" className="rc-field__count pc-field__count">
            {reason.length} / {REASON_MAX_LENGTH}
          </span>
        </div>
      </div>

      {submitError && (
        <p className="rc-alert" role="alert">
          <span aria-hidden="true">✕ </span>
          {submitError}
        </p>
      )}

      <div className="pc-details__actions">
        <div className="pc-details__buttons">
          <button type="button" className="rc-button" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button
            type="submit"
            className="rc-submit"
            disabled={!canSubmit || submitting}
            aria-busy={submitting || undefined}
          >
            {submitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>
      </div>
    </section>
  )
}

export default ProgramChangeDetails

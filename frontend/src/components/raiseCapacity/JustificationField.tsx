const JUSTIFICATION_MAX_LENGTH = 1000

interface JustificationFieldProps {
  value: string
  onChange: (value: string) => void
  /** Validation message shown under the field, as in the prototype. */
  error?: string | null
}

// Required reason for the request, with the prototype's help text and
// character counter.
function JustificationField({ value, onChange, error }: JustificationFieldProps) {
  const describedBy = ['rc-justification-help', 'rc-justification-count', error ? 'rc-just-err' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className="rc-field">
      <label htmlFor="rc-justification" className="rc-field__label">
        Justification for Request{' '}
        <span className="rc-field__required" aria-hidden="true">
          *
        </span>
        <span className="student-visually-hidden">(required)</span>
      </label>
      <span id="rc-justification-help" className="rc-field__help">
        Explain why you need a seat in this section, for example graduation
        plan or schedule conflicts.
      </span>
      <textarea
        id="rc-justification"
        className="rc-field__input"
        rows={5}
        maxLength={JUSTIFICATION_MAX_LENGTH}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {error && (
        <span id="rc-just-err" className="rc-error">
          <span aria-hidden="true">✕ </span>
          {error}
        </span>
      )}
      <span id="rc-justification-count" className="rc-field__count">
        {value.length} / {JUSTIFICATION_MAX_LENGTH}
      </span>
    </div>
  )
}

export default JustificationField

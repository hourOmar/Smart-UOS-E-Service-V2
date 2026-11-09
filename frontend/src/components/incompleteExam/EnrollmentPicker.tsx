import type { IncompleteExamEnrollment } from '../../services/incompleteExamSubmission'
import { CURRENT_TERM } from '../../config/academicTerm'

interface EnrollmentPickerProps {
  status: 'loading' | 'ready' | 'error'
  enrollments: IncompleteExamEnrollment[]
  onRetry: () => void
  selectedKey: string | null
  onSelect: (key: string) => void
  error?: string | null
}

// Left column: one of the student's OWN course sections of the current term
// (from Takes), in the Raise Capacity picker's design.
function EnrollmentPicker({ status, enrollments, onRetry, selectedKey, onSelect, error }: EnrollmentPickerProps) {
  return (
    <section className="rc-panel rc-picker" aria-labelledby="ie-picker-title">
      <div className="rc-picker__head">
        <div className="rc-panel__title-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true">
            <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM13 4h5.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H13z" />
          </svg>
          <h2 id="ie-picker-title" className="rc-panel__title">
            Select Course
          </h2>
        </div>
        <p className="ie-picker__help">Your registered course sections for term {CURRENT_TERM}.</p>
      </div>

      {error && (
        <p id="ie-sel-err" className="rc-error rc-picker__error">
          <span aria-hidden="true">✕ </span>
          {error}
        </p>
      )}

      <div className="rc-picker__body">
        {status === 'loading' && (
          <p className="rc-picker__state" role="status">
            Loading your course sections…
          </p>
        )}

        {status === 'error' && (
          <div className="rc-picker__state" role="alert">
            <p>We couldn’t load your course sections.</p>
            <button type="button" className="rc-button" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}

        {status === 'ready' && enrollments.length === 0 && (
          <p className="rc-picker__state" role="status">
            You are not registered in any course section for term {CURRENT_TERM}.
          </p>
        )}

        {status === 'ready' && enrollments.length > 0 && (
          <div
            className="rc-picker__list"
            role="radiogroup"
            aria-label="Your course sections"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'ie-sel-err' : undefined}
          >
            {enrollments.map((enrollment) => {
              const selected = enrollment.key === selectedKey
              return (
                <label key={enrollment.key} className="rc-option" data-selected={selected}>
                  <input
                    type="radio"
                    name="ie-section"
                    className="student-visually-hidden"
                    checked={selected}
                    onChange={() => onSelect(enrollment.key)}
                  />
                  <span className="rc-option__top">
                    <span className="rc-option__code">{enrollment.courseId}</span>
                    <span className="rc-option__chip">Section {enrollment.sectionId}</span>
                  </span>
                  <span className="rc-option__name">{enrollment.courseName || enrollment.courseId}</span>
                  <span className="rc-option__meta">
                    <span>Term {enrollment.term}</span>
                    {enrollment.openExamTypes.length > 0 && (
                      <span className="rc-badge">
                        Request in progress: {enrollment.openExamTypes.join(', ')}
                      </span>
                    )}
                  </span>
                  {selected && (
                    <span className="rc-option__check" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                        strokeLinecap="round" strokeLinejoin="round">
                        <path d="m6 12.5 4 4 8-9" />
                      </svg>
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

export default EnrollmentPicker

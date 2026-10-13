import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  CATALOG_ANCHOR_ID,
  serviceDetailsPath,
} from '../data/academicRequests'
import useStudentProfile from '../hooks/useStudentProfile'
import useRaiseCapacitySections from '../hooks/useRaiseCapacitySections'
import {
  RaiseCapacitySubmitError,
  submitRaiseCapacityRequest,
} from '../services/raiseCapacity'
import StudentLayout from '../components/student/StudentLayout'
import SectionPicker from '../components/raiseCapacity/SectionPicker'
import SelectedSection from '../components/raiseCapacity/SelectedSection'
import JustificationField from '../components/raiseCapacity/JustificationField'
import RequestSummary from '../components/raiseCapacity/RequestSummary'
import './RaiseCapacityForm.css'

// The prototype asks for a little detail before a request is sent.
const JUSTIFICATION_MIN_LENGTH = 20

interface FieldErrors {
  section?: string
  justification?: string
}

interface SubmittedRequest {
  id: string
  title: string
}

// Raise Capacity request form: course selection on the left, request
// details and summary on the right. Sections come from the database, and
// Submit Request saves the request through submit_raise_capacity_request.
function RaiseCapacityForm() {
  const location = useLocation()
  const navigate = useNavigate()
  const profile = useStudentProfile()
  const { status, sections, retry } = useRaiseCapacitySections()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [justification, setJustification] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<SubmittedRequest | null>(null)
  // Guards against a second submission before React re-renders the
  // disabled button (e.g. a fast double click).
  const submittingRef = useRef(false)
  const doneHeadingRef = useRef<HTMLHeadingElement>(null)

  const selected = sections.find((section) => section.key === selectedKey) ?? null

  // Back and Cancel return to where the student came from: the Raise
  // Capacity details page, or otherwise the Academic Requests section.
  const fromDetails =
    (location.state as { from?: string } | null)?.from === 'details'
  const back = fromDetails
    ? { to: serviceDetailsPath('raise-capacity'), state: undefined, label: 'Back to Raise Capacity details' }
    : { to: '/student', state: { scrollTo: CATALOG_ANCHOR_ID }, label: 'Back to Academic Requests' }

  useEffect(() => {
    if (submitted) doneHeadingRef.current?.focus()
  }, [submitted])

  const handleSelect = (key: string) => {
    setSelectedKey(key)
    setFieldErrors((errors) => ({ ...errors, section: undefined }))
    setSubmitError(null)
  }

  const handleJustification = (value: string) => {
    setJustification(value)
    setFieldErrors((errors) => ({ ...errors, justification: undefined }))
    setSubmitError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current) return

    // Same checks and wording as the prototype.
    const length = justification.trim().length
    const errors: FieldErrors = {}
    if (!selected) errors.section = 'Select a course section.'
    if (!length) errors.justification = 'Enter a justification for your request.'
    else if (length < JUSTIFICATION_MIN_LENGTH) {
      errors.justification = `Add a little more detail (at least ${JUSTIFICATION_MIN_LENGTH} characters).`
    }
    setFieldErrors(errors)
    setSubmitError(null)

    if (errors.section || errors.justification || !selected) {
      const target = errors.section
        ? document.querySelector<HTMLElement>('.rc-picker__list input, #rc-search')
        : document.getElementById('rc-justification')
      target?.focus()
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    try {
      const requestId = await submitRaiseCapacityRequest(selected, justification)
      setSubmitted({
        id: requestId,
        title: `${selected.courseId} ${selected.courseName} · Section ${selected.sectionId}`,
      })
    } catch (error) {
      setSubmitError(
        error instanceof RaiseCapacitySubmitError
          ? error.message
          : new RaiseCapacitySubmitError('unknown').message,
      )
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <StudentLayout profile={profile} solidHeader>
      <div className="rc-page">
        <Link to={back.to} state={back.state} className="rc-page__back">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M13.5 8.5 10 12l3.5 3.5" />
          </svg>
          {back.label}
        </Link>

        <div className="rc-page__intro">
          <h1 className="rc-page__title">Raise Capacity Request</h1>
          <p className="rc-page__lede">
            Select a course section and explain why you need a seat.
          </p>
        </div>

        {submitted ? (
          <section className="rc-done" role="status" aria-labelledby="rc-done-title">
            <div className="rc-done__body">
              <span className="rc-done__icon" aria-hidden="true">
                ✓
              </span>
              <h2
                id="rc-done-title"
                ref={doneHeadingRef}
                tabIndex={-1}
                className="rc-done__title"
              >
                Request submitted
              </h2>
              <p className="rc-done__text">
                Your Raise Capacity request for <strong>{submitted.title}</strong>{' '}
                has been submitted for review.
              </p>
              <div className="rc-done__ref">
                <span className="rc-done__ref-label">Request ID</span>
                <span className="rc-done__id">{submitted.id}</span>
              </div>
            </div>
            <div className="rc-done__actions">
              <button
                type="button"
                className="rc-button"
                onClick={() => navigate('/student')}
              >
                Back to dashboard
              </button>
            </div>
          </section>
        ) : (
          <form className="rc-page__columns" onSubmit={handleSubmit} noValidate>
            <SectionPicker
              status={status}
              sections={sections}
              onRetry={retry}
              selectedKey={selectedKey}
              onSelect={handleSelect}
              error={fieldErrors.section}
            />

            <section
              className="rc-panel rc-details"
              aria-labelledby="rc-details-title"
            >
              <div className="rc-panel__title-row rc-details__head">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M7 3.5h7l4.5 4.5v12.5H7zM14 3.5V8h4.5M10 13h5.5M10 16.5h4" />
                </svg>
                <h2 id="rc-details-title" className="rc-panel__title">
                  Request Details
                </h2>
              </div>

              <SelectedSection section={selected} />
              <JustificationField
                value={justification}
                onChange={handleJustification}
                error={fieldErrors.justification}
              />
              <RequestSummary section={selected} justification={justification} />

              {submitError && (
                <p className="rc-alert" role="alert">
                  <span aria-hidden="true">✕ </span>
                  {submitError}
                </p>
              )}

              <div className="rc-details__actions">
                <button
                  type="button"
                  className="rc-button"
                  onClick={() => navigate(back.to, { state: back.state })}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rc-submit"
                  disabled={submitting}
                  aria-busy={submitting || undefined}
                >
                  {submitting ? 'Submitting…' : 'Submit Request'}
                </button>
              </div>
            </section>
          </form>
        )}
      </div>
    </StudentLayout>
  )
}

export default RaiseCapacityForm

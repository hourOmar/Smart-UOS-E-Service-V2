import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CATALOG_ANCHOR_ID, serviceDetailsPath } from '../data/academicRequests'
import useStudentProfile from '../hooks/useStudentProfile'
import useCourseSubstitutionData from '../hooks/useCourseSubstitutionData'
import { CourseSubstitutionSubmitError, submitCourseSubstitutionRequest } from '../services/courseSubstitution'
import {
  BLOCKED_MESSAGES,
  NO_ORIGINAL_COURSES,
  NO_PROPOSED_COURSES,
  REASON_MAX_LENGTH,
  RELOAD_OPTIONS_CODES,
  courseLabel,
  validateCourseSubstitutionForm,
} from '../utils/courseSubstitutionSubmission'
import { requestDetailsPath } from '../utils/requestPaths'
import StudentLayout from '../components/student/StudentLayout'
import ServiceBreadcrumb from '../components/student/ServiceBreadcrumb'
import CourseCombobox from '../components/courseEquivalency/CourseCombobox'
import { CapIcon } from '../components/programChange/CurrentProgramCard'
import './RaiseCapacityForm.css'
import './ProgramChangeForm.css'
import './CourseSubstitutionForm.css'

interface SubmittedRequest {
  id: string
  original: string
  proposed: string
}

// Course Substitution request form: a Required course of the student's current
// study plan to replace, an Elective course of the same plan to take instead,
// and a reason. Both lists come from public.get_my_course_substitution_options
// (the program on the student's own record; courses already passed or in
// progress are left out). Submit Request saves the request through
// public.submit_course_substitution_request, which identifies the student from
// the session and enforces the same rules. Level and offering rules are left
// to the agent and staff.
function CourseSubstitutionForm() {
  const location = useLocation()
  const navigate = useNavigate()
  const profile = useStudentProfile()
  const { status, options, retry } = useCourseSubstitutionData()
  const originalCourses = options?.originalCourses ?? []
  const proposedCourses = options?.proposedCourses ?? []
  const [originalId, setOriginalId] = useState<string | null>(null)
  const [proposedId, setProposedId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [reasonTouched, setReasonTouched] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<SubmittedRequest | null>(null)
  // Guards against a second submission before React re-renders the
  // disabled button (e.g. a fast double click).
  const submittingRef = useRef(false)
  const doneHeadingRef = useRef<HTMLHeadingElement>(null)

  const errors = validateCourseSubstitutionForm({ originalCourseId: originalId, proposedCourseId: proposedId, reason })
  const reasonShown = attempted || reasonTouched ? (errors.reason ?? null) : null

  // Cancel returns to where the student came from: the Course
  // Substitution details page, or otherwise the Academic Requests section.
  const fromDetails = (location.state as { from?: string } | null)?.from === 'details'
  const exit = fromDetails
    ? { to: serviceDetailsPath('course-substitution'), state: undefined }
    : { to: '/student', state: { scrollTo: CATALOG_ANCHOR_ID } }

  useEffect(() => {
    if (submitted) doneHeadingRef.current?.focus()
  }, [submitted])

  const chooseOriginal = (id: string) => {
    if (submittingRef.current) return
    setOriginalId(id)
    // The same course cannot be both; the proposed choice is cleared.
    if (proposedId === id) setProposedId(null)
    setSubmitError(null)
  }

  const chooseProposed = (id: string) => {
    if (submittingRef.current) return
    setProposedId(id)
    setSubmitError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current) return
    setAttempted(true)
    if (!originalId || !proposedId || Object.keys(errors).length > 0) return

    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    try {
      const requestId = await submitCourseSubstitutionRequest(originalId, proposedId, reason)
      const label = (id: string) =>
        courseLabel([...originalCourses, ...proposedCourses].find((course) => course.id === id)) || id
      setSubmitted({ id: requestId, original: label(originalId), proposed: label(proposedId) })
      window.scrollTo(0, 0)
    } catch (error) {
      setSubmitError(
        error instanceof CourseSubstitutionSubmitError
          ? error.message
          : new CourseSubstitutionSubmitError('unknown').message,
      )
      // The study plan, transcript or course list changed since the page
      // loaded: reload the options and clear both choices.
      if (error instanceof CourseSubstitutionSubmitError && RELOAD_OPTIONS_CODES.has(error.code)) {
        setOriginalId(null)
        setProposedId(null)
        retry()
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <StudentLayout profile={profile} solidHeader>
      <div className="rc-page pc-page csf-page">
        <ServiceBreadcrumb serviceId="course-substitution" current="New Request" />

        <div className="rc-page__intro">
          <h1 className="rc-page__title pc-page__title">Course Substitution Request</h1>
          <p className="rc-page__lede">
            Request to replace a course in your study plan with another course.
          </p>
        </div>

        {submitted ? (
          <section className="rc-done pc-done" role="status" aria-labelledby="csf-done-title">
            <div className="rc-done__body">
              <span className="rc-done__icon" aria-hidden="true">
                ✓
              </span>
              <h2 id="csf-done-title" ref={doneHeadingRef} tabIndex={-1} className="rc-done__title">
                Request submitted
              </h2>
              <p className="rc-done__text">
                Your request to replace <strong>{submitted.original}</strong> with <strong>{submitted.proposed}</strong>{' '}
                has been sent to the Registrar’s Office for review.
              </p>
              <div className="rc-done__ref">
                <span className="rc-done__ref-label">Request ID</span>
                <span className="rc-done__id">{submitted.id}</span>
              </div>
            </div>
            <div className="rc-done__actions">
              <button type="button" className="rc-submit" onClick={() => navigate(requestDetailsPath(submitted.id))}>
                View request
              </button>
              <button type="button" className="rc-button" onClick={() => navigate('/student')}>
                Back to dashboard
              </button>
            </div>
          </section>
        ) : (
          <>
            {status === 'loading' && (
              <p className="pc-state" role="status">
                Loading your study plan and courses…
              </p>
            )}

            {status === 'error' && (
              <div className="rc-alert pc-load-error" role="alert">
                <span>
                  <span aria-hidden="true">✕ </span>
                  We couldn’t load your study plan and courses. Check your connection and try again.
                </span>
                <button type="button" className="rc-button" onClick={retry}>
                  Try again
                </button>
              </div>
            )}

            {status === 'ready' && options && options.status !== 'ok' && (
              <section className="csf-blocked" role="alert" aria-labelledby="csf-blocked-title">
                <h2 id="csf-blocked-title" className="csf-blocked__title">
                  {BLOCKED_MESSAGES[options.status].title}
                </h2>
                <p className="csf-blocked__text">{BLOCKED_MESSAGES[options.status].text}</p>
                {options.status === 'study_plan_unavailable' && options.program && (
                  <p className="csf-blocked__text">
                    Your program: <strong>{options.program.programName}</strong>
                  </p>
                )}
                <div className="csf-blocked__actions">
                  {options.status === 'unexpected' && (
                    <button type="button" className="rc-button" onClick={retry}>
                      Try again
                    </button>
                  )}
                  <Link to="/student" state={{ scrollTo: CATALOG_ANCHOR_ID }} className="rc-button">
                    Academic requests
                  </Link>
                  <Link to="/student" className="rc-submit">
                    Back to dashboard
                  </Link>
                </div>
              </section>
            )}

            {status === 'ready' && options?.status === 'ok' && options.program && (
              <section className="pc-current csf-program" aria-label="Your study plan">
                <span className="pc-current__icon" aria-hidden="true">
                  <CapIcon size={30} />
                </span>
                <div className="pc-current__program">
                  <span className="pc-current__label">Your program</span>
                  <span className="pc-current__name">{options.program.programName}</span>
                </div>
              </section>
            )}

            {status === 'ready' && options?.status === 'ok' && (originalCourses.length === 0 || proposedCourses.length === 0) && (
              <p className="pc-state" role="status">
                {originalCourses.length === 0 ? NO_ORIGINAL_COURSES : NO_PROPOSED_COURSES}
              </p>
            )}

            {status === 'ready' && options?.status === 'ok' && originalCourses.length > 0 && proposedCourses.length > 0 && (
              <form className="pc-form csf-form" onSubmit={handleSubmit} noValidate aria-busy={submitting || undefined}>
                <section className="pc-details" aria-labelledby="csf-details-title">
                  <div className="pc-details__head">
                    <div className="pc-details__heading">
                      <h2 id="csf-details-title" className="pc-details__title">Request Details</h2>
                      <span className="pc-details__sub">Choose both courses and explain why you need the substitution.</span>
                    </div>
                  </div>

                  <CourseCombobox
                    id="csf-original"
                    label="Original course"
                    placeholder="Search or select the course to replace"
                    courses={originalCourses}
                    selectedId={originalId}
                    onSelect={chooseOriginal}
                    error={attempted ? (errors.originalCourse ?? null) : null}
                    disabled={submitting}
                  />

                  <CourseCombobox
                    id="csf-proposed"
                    label="Proposed course"
                    placeholder="Search or select the course to take instead"
                    courses={proposedCourses}
                    selectedId={proposedId}
                    excludedId={originalId}
                    onSelect={chooseProposed}
                    error={attempted ? (errors.proposedCourse ?? null) : null}
                    disabled={submitting}
                  />

                  <div className="rc-field">
                    <label htmlFor="csf-reason" className="rc-field__label">
                      Reason for substitution <span className="rc-field__required" aria-hidden="true">*</span>
                      <span className="student-visually-hidden">(required)</span>
                    </label>
                    <textarea
                      id="csf-reason"
                      className="rc-field__input"
                      rows={5}
                      maxLength={REASON_MAX_LENGTH}
                      required
                      placeholder="Explain why you need this substitution."
                      value={reason}
                      onChange={(event) => {
                        setReason(event.target.value)
                        setSubmitError(null)
                      }}
                      onBlur={() => setReasonTouched(true)}
                      disabled={submitting}
                      aria-invalid={reasonShown ? true : undefined}
                      aria-describedby={['csf-reason-count', reasonShown ? 'csf-reason-error' : ''].filter(Boolean).join(' ')}
                    />
                    <div className="pc-field__foot">
                      {reasonShown && (
                        <span id="csf-reason-error" className="rc-error">
                          <span aria-hidden="true">✕ </span>
                          {reasonShown}
                        </span>
                      )}
                      <span id="csf-reason-count" className="rc-field__count pc-field__count">
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
                      <Link to={exit.to} state={exit.state} className="rc-button">
                        Cancel
                      </Link>
                      <button
                        type="submit"
                        className="rc-submit"
                        disabled={submitting}
                        aria-busy={submitting || undefined}
                      >
                        {submitting ? 'Submitting…' : 'Submit Request'}
                      </button>
                    </div>
                  </div>
                </section>
              </form>
            )}
          </>
        )}
      </div>
    </StudentLayout>
  )
}

export default CourseSubstitutionForm

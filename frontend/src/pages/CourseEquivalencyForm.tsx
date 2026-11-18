import { useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CATALOG_ANCHOR_ID, serviceDetailsPath } from '../data/academicRequests'
import useStudentProfile from '../hooks/useStudentProfile'
import useCourseEquivalencyOptions from '../hooks/useCourseEquivalencyOptions'
import { CourseEquivalencySubmitError, submitCourseEquivalencyRequest } from '../services/courseEquivalency'
import {
  BLOCKED_MESSAGES,
  REASON_MAX_LENGTH,
  RELOAD_OPTIONS_CODES,
  completedCourseOptions,
  planCourseOptions,
  validateCourseEquivalencyForm,
} from '../utils/courseEquivalencySubmission'
import { requestDetailsPath } from '../utils/requestPaths'
import StudentLayout from '../components/student/StudentLayout'
import ServiceBreadcrumb from '../components/student/ServiceBreadcrumb'
import CourseCombobox from '../components/courseEquivalency/CourseCombobox'
import { CapIcon } from '../components/programChange/CurrentProgramCard'
import './RaiseCapacityForm.css'
import './ProgramChangeForm.css'
import './CourseSubstitutionForm.css'
import './CourseEquivalencyForm.css'

// Course Equivalency request form: a course the student completed (any recorded
// grade; the best attempt is shown) to count as a course in the current study
// plan of the program from their latest approved Program Change, plus a reason. Everything comes
// from public.get_my_course_equivalency_options and is saved through
// public.submit_course_equivalency_request; both identify the student from the
// session and enforce every rule again. The program stored on the student's own
// record is not used to decide eligibility.
function CourseEquivalencyForm() {
  const location = useLocation()
  const navigate = useNavigate()
  const profile = useStudentProfile()
  const { status, options, retry } = useCourseEquivalencyOptions()
  const [oldCourseId, setOldCourseId] = useState<string | null>(null)
  const [newCourseId, setNewCourseId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [reasonTouched, setReasonTouched] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Guards against a second submission before React re-renders the disabled
  // button (e.g. a fast double click).
  const submittingRef = useRef(false)

  const oldOptions = useMemo(() => completedCourseOptions(options?.oldCourses ?? []), [options])
  const newOptions = useMemo(() => planCourseOptions(options?.newCourses ?? []), [options])

  const errors = validateCourseEquivalencyForm({ oldCourseId, newCourseId, reason })
  const reasonShown = attempted || reasonTouched ? (errors.reason ?? null) : null

  // Cancel returns to where the student came from: the Course Equivalency
  // details page, or otherwise the Academic Requests section of the dashboard.
  const fromDetails = (location.state as { from?: string } | null)?.from === 'details'
  const exit = fromDetails
    ? { to: serviceDetailsPath('course-equivalency'), state: undefined }
    : { to: '/student', state: { scrollTo: CATALOG_ANCHOR_ID } }

  const chooseOld = (id: string) => {
    if (submittingRef.current) return
    setOldCourseId(id)
    if (newCourseId === id) setNewCourseId(null)
    setSubmitError(null)
  }

  const chooseNew = (id: string) => {
    if (submittingRef.current) return
    setNewCourseId(id)
    setSubmitError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current) return
    setAttempted(true)
    if (!oldCourseId || !newCourseId || Object.keys(errors).length > 0) return

    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    try {
      const requestId = await submitCourseEquivalencyRequest(oldCourseId, newCourseId, reason)
      // Only after the database returned the new Request_ID.
      navigate(requestDetailsPath(requestId))
    } catch (error) {
      const failure = error instanceof CourseEquivalencySubmitError ? error : new CourseEquivalencySubmitError('unknown')
      setSubmitError(failure.message)
      // The program or the course lists changed since the page loaded: reload them.
      if (RELOAD_OPTIONS_CODES.has(failure.code)) {
        setOldCourseId(null)
        setNewCourseId(null)
        retry()
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const blocked = status === 'ready' && options && options.status !== 'ok' ? BLOCKED_MESSAGES[options.status] : null
  const program = options?.program ?? null

  return (
    <StudentLayout profile={profile} solidHeader>
      <div className="rc-page pc-page csf-page cef-page">
        <ServiceBreadcrumb serviceId="course-equivalency" current="New Request" />

        <div className="rc-page__intro">
          <h1 className="rc-page__title pc-page__title">Course Equivalency Request</h1>
          <p className="rc-page__lede">
            Request that a course you completed count as a course in the study plan of your new program, after an
            approved program change.
          </p>
        </div>

        {submitError && (
          <p className="rc-alert" role="alert">
            <span aria-hidden="true">✕ </span>
            {submitError}
          </p>
        )}

        {status === 'loading' && (
          <p className="pc-state" role="status">
            Loading your program and courses…
          </p>
        )}

        {status === 'error' && (
          <div className="rc-alert pc-load-error" role="alert">
            <span>
              <span aria-hidden="true">✕ </span>
              We couldn’t load your program and courses. Check your connection and try again.
            </span>
            <button type="button" className="rc-button" onClick={retry}>
              Try again
            </button>
          </div>
        )}

        {blocked && options && (
          <section className="cef-blocked" role="alert" aria-labelledby="cef-blocked-title">
            <h2 id="cef-blocked-title" className="cef-blocked__title">
              {blocked.title}
            </h2>
            <p className="cef-blocked__text">{blocked.text}</p>
            {options.status === 'study_plan_unavailable' && program && (
              <p className="cef-blocked__text">
                Your new program: <strong>{program.programName}</strong>
              </p>
            )}
            <div className="cef-blocked__actions">
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

        {status === 'ready' && options?.status === 'ok' && program && (
          <>
            <section className="pc-current cef-program" aria-label="Applicable program">
              <span className="pc-current__icon" aria-hidden="true">
                <CapIcon size={30} />
              </span>
              <div className="pc-current__program">
                <span className="pc-current__label">Your new program (approved program change)</span>
                <span className="pc-current__name">{program.programName}</span>
                {program.planVersion && (
                  <span className="pc-current__college">Study plan version {program.planVersion}</span>
                )}
              </div>
            </section>

            {oldOptions.length === 0 || newOptions.length === 0 ? (
              <p className="pc-state" role="status">
                {oldOptions.length === 0
                  ? 'You have no completed course with a recorded grade, so a course equivalency cannot be requested.'
                  : 'Your new program’s current study plan has no courses available, so there is nothing to request.'}
              </p>
            ) : (
              <form className="pc-form csf-form" onSubmit={handleSubmit} noValidate aria-busy={submitting || undefined}>
                <section className="pc-details" aria-labelledby="cef-details-title">
                  <div className="pc-details__head">
                    <div className="pc-details__heading">
                      <h2 id="cef-details-title" className="pc-details__title">Request Details</h2>
                      <span className="pc-details__sub">
                        Choose the course you completed, the course it should count as, and explain why.
                      </span>
                    </div>
                  </div>

                  <CourseCombobox
                    id="cef-old"
                    label="Completed course"
                    hint="A course from your transcript with a recorded grade (your best attempt is shown)."
                    placeholder="Search or select a completed course"
                    courses={oldOptions}
                    selectedId={oldCourseId}
                    onSelect={chooseOld}
                    error={attempted ? (errors.oldCourse ?? null) : null}
                    disabled={submitting}
                  />

                  <CourseCombobox
                    id="cef-new"
                    label="Equivalent course in your new program"
                    hint="A course in your new program’s current study plan."
                    placeholder="Search or select an equivalent course"
                    courses={newOptions}
                    selectedId={newCourseId}
                    excludedId={oldCourseId}
                    onSelect={chooseNew}
                    error={attempted ? (errors.newCourse ?? null) : null}
                    disabled={submitting}
                  />

                  <div className="rc-field">
                    <label htmlFor="cef-reason" className="rc-field__label">
                      Reason for equivalency <span className="rc-field__required" aria-hidden="true">*</span>
                      <span className="student-visually-hidden">(required)</span>
                    </label>
                    <textarea
                      id="cef-reason"
                      className="rc-field__input"
                      rows={5}
                      maxLength={REASON_MAX_LENGTH}
                      required
                      placeholder="Explain why the completed course should count as the new course."
                      value={reason}
                      onChange={(event) => {
                        setReason(event.target.value)
                        setSubmitError(null)
                      }}
                      onBlur={() => setReasonTouched(true)}
                      disabled={submitting}
                      aria-invalid={reasonShown ? true : undefined}
                      aria-describedby={['cef-reason-count', reasonShown ? 'cef-reason-error' : ''].filter(Boolean).join(' ')}
                    />
                    <div className="pc-field__foot">
                      {reasonShown && (
                        <span id="cef-reason-error" className="rc-error">
                          <span aria-hidden="true">✕ </span>
                          {reasonShown}
                        </span>
                      )}
                      <span id="cef-reason-count" className="rc-field__count pc-field__count">
                        {reason.length} / {REASON_MAX_LENGTH}
                      </span>
                    </div>
                  </div>

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

export default CourseEquivalencyForm

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CATALOG_ANCHOR_ID, serviceDetailsPath } from '../data/academicRequests'
import useStudentProfile from '../hooks/useStudentProfile'
import useProgramChangeData from '../hooks/useProgramChangeData'
import {
  ProgramChangeSubmitError,
  reasonError,
  submitProgramChangeRequest,
  type Program,
} from '../services/programChange'
import { requestDetailsPath } from '../utils/requestPaths'
import StudentLayout from '../components/student/StudentLayout'
import CurrentProgramCard from '../components/programChange/CurrentProgramCard'
import CollegePicker from '../components/programChange/CollegePicker'
import ProgramPicker from '../components/programChange/ProgramPicker'
import ProgramChangeDetails from '../components/programChange/ProgramChangeDetails'
import './RaiseCapacityForm.css'
import './ProgramChangeForm.css'

interface SubmittedRequest {
  id: string
  programName: string
}

// Program Change request form, following the approved prototype: the
// student's current program, then 1. a target college, then one of its
// programs and a reason. Colleges and programs come from public."Program";
// the current program from the student's own record. Submit Request saves
// the request through public.submit_program_change_request.
function ProgramChangeForm() {
  const location = useLocation()
  const navigate = useNavigate()
  const profile = useStudentProfile()
  const { status, colleges, current, retry } = useProgramChangeData()
  const [collegeName, setCollegeName] = useState<string | null>(null)
  const [programKey, setProgramKey] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [reasonTouched, setReasonTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<SubmittedRequest | null>(null)
  // Guards against a second submission before React re-renders the
  // disabled button (e.g. a fast double click).
  const submittingRef = useRef(false)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const doneHeadingRef = useRef<HTMLHeadingElement>(null)

  const college = colleges.find((entry) => entry.name === collegeName) ?? null
  const selected = college?.programs.find((program) => program.key === programKey) ?? null
  const canSubmit = selected !== null && reasonError(reason) === null && !submitting

  // Leaving the form returns to where the student came from: the Program
  // Change details page, or otherwise the Academic Requests section.
  const fromDetails = (location.state as { from?: string } | null)?.from === 'details'
  const exit = fromDetails
    ? { to: serviceDetailsPath('program-change'), state: undefined, label: 'Back to Program Change details' }
    : { to: '/student', state: { scrollTo: CATALOG_ANCHOR_ID }, label: 'Back to Dashboard' }

  useEffect(() => {
    if (submitted) doneHeadingRef.current?.focus()
  }, [submitted])

  // After a step change, start at the top and announce the new title.
  const showStep = () => {
    window.scrollTo(0, 0)
    window.setTimeout(() => titleRef.current?.focus(), 0)
  }

  const chooseCollege = (name: string) => {
    setCollegeName(name)
    setProgramKey(null)
    setSubmitError(null)
    showStep()
  }

  // As in the prototype, going back keeps the reason already written.
  const backToColleges = () => {
    if (submittingRef.current) return
    setCollegeName(null)
    setProgramKey(null)
    setSubmitError(null)
    showStep()
  }

  const chooseProgram = (program: Program) => {
    if (submittingRef.current) return
    setProgramKey(program.key)
    setSubmitError(null)
  }

  const changeReason = (value: string) => {
    setReason(value)
    setSubmitError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current) return
    setReasonTouched(true)
    if (!selected || reasonError(reason) !== null) return

    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    try {
      const requestId = await submitProgramChangeRequest(selected, reason)
      setSubmitted({ id: requestId, programName: selected.programName })
      window.scrollTo(0, 0)
    } catch (error) {
      setSubmitError(
        error instanceof ProgramChangeSubmitError
          ? error.message
          : new ProgramChangeSubmitError('unknown').message,
      )
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const backIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M13.5 8.5 10 12l3.5 3.5" />
    </svg>
  )

  return (
    <StudentLayout profile={profile} solidHeader>
      <div className="rc-page pc-page">
        {college && !submitted ? (
          <button
            type="button"
            className="rc-page__back pc-page__back-button"
            onClick={backToColleges}
            disabled={submitting}
          >
            {backIcon}
            Back to Colleges
          </button>
        ) : (
          <Link to={exit.to} state={exit.state} className="rc-page__back">
            {backIcon}
            {exit.label}
          </Link>
        )}

        <div className="rc-page__intro">
          <h1 ref={titleRef} tabIndex={-1} className="rc-page__title pc-page__title">
            {college ? college.name : 'Program Change Request'}
          </h1>
          <p className="rc-page__lede">
            {college
              ? 'Select the program you want to move to.'
              : 'Request to move from your current program to another major or program.'}
          </p>
        </div>

        {submitted ? (
          <section className="rc-done pc-done" role="status" aria-labelledby="pc-done-title">
            <div className="rc-done__body">
              <span className="rc-done__icon" aria-hidden="true">
                ✓
              </span>
              <h2 id="pc-done-title" ref={doneHeadingRef} tabIndex={-1} className="rc-done__title">
                Request submitted
              </h2>
              <p className="rc-done__text">
                Your request to change to <strong>{submitted.programName}</strong> has been sent to the
                Registrar’s Office for review.
              </p>
              <div className="rc-done__ref">
                <span className="rc-done__ref-label">Request ID</span>
                <span className="rc-done__id">{submitted.id}</span>
              </div>
            </div>
            <div className="rc-done__actions">
              <button
                type="button"
                className="rc-submit"
                onClick={() => navigate(requestDetailsPath(submitted.id))}
              >
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
                Loading your current program and the list of programs…
              </p>
            )}

            {status === 'error' && (
              <div className="rc-alert pc-load-error" role="alert">
                <span>
                  <span aria-hidden="true">✕ </span>
                  We couldn’t load your program or the list of programs. Check your connection and try again.
                </span>
                <button type="button" className="rc-button" onClick={retry}>
                  Try again
                </button>
              </div>
            )}

            {status === 'ready' && current === null && (
              <p className="rc-alert" role="alert">
                <span aria-hidden="true">✕ </span>
                This account is not linked to a student record, so a program change cannot be requested.
              </p>
            )}

            {status === 'ready' && current !== null && (
              <>
                <CurrentProgramCard current={current} />

                {colleges.length === 0 ? (
                  <p className="pc-state" role="status">
                    No programs are available right now.
                  </p>
                ) : college ? (
                  <form className="pc-form" onSubmit={handleSubmit} noValidate aria-busy={submitting || undefined}>
                    <ProgramPicker
                      collegeName={college.name}
                      programs={college.programs}
                      current={current}
                      selectedKey={programKey}
                      onSelect={chooseProgram}
                    />
                    <ProgramChangeDetails
                      selected={selected}
                      currentProgramName={current.programName}
                      reason={reason}
                      onReasonChange={changeReason}
                      onReasonBlur={() => setReasonTouched(true)}
                      error={reasonTouched ? reasonError(reason) : null}
                      onCancel={backToColleges}
                      canSubmit={canSubmit}
                      submitting={submitting}
                      submitError={submitError}
                    />
                  </form>
                ) : (
                  <CollegePicker colleges={colleges} selectedName={collegeName} onSelect={chooseCollege} />
                )}
              </>
            )}
          </>
        )}
      </div>
    </StudentLayout>
  )
}

export default ProgramChangeForm

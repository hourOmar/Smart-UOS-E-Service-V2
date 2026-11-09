import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CATALOG_ANCHOR_ID, serviceDetailsPath } from '../data/academicRequests'
import useStudentProfile from '../hooks/useStudentProfile'
import useIncompleteExamEnrollments from '../hooks/useIncompleteExamEnrollments'
import {
  checkSelectedProof,
  proofEntryFor,
  submitIncompleteExam,
  type ProofEntry,
  type UploadReservation,
} from '../services/incompleteExamSubmission'
import {
  INCOMPLETE_EXAM_TYPE,
  PROOF_FILE_PROBLEM_MESSAGES,
  PROOF_NOTE_MAX_LENGTH,
  PROOF_SELECTION_PROBLEM_MESSAGES,
  REASON_MAX_LENGTH,
  SUBMISSION_WINDOW_WORKING_DAYS,
  SUBMIT_ERROR_MESSAGES,
  checkProofSelection,
  isLateSubmission,
  uaeToday,
  validateIncompleteExamForm,
  type ExamType,
  type FormErrors,
  type IncompleteExamForm as IncompleteExamFormValues,
} from '../utils/incompleteExamSubmission'
import { submissionBlocker } from '../utils/incompleteExamSubmissionFlow'
import { requestDetailsPath } from '../utils/requestPaths'
import StudentLayout from '../components/student/StudentLayout'
import EnrollmentPicker from '../components/incompleteExam/EnrollmentPicker'
import ProofFilesField from '../components/incompleteExam/ProofFilesField'
import './RaiseCapacityForm.css'
import './IncompleteExamForm.css'

interface SubmittedRequest {
  id: string
  title: string
  examType: ExamType
  documents: number
}

const DUPLICATE_EXAM_MESSAGE =
  'You already have an Incomplete Exam request in progress for this exam. You can find it in My Requests.'
const FAILED_FILES_MESSAGE =
  'Some documents could not be uploaded, so your request was not submitted. Remove each file marked “Not uploaded”, select it again, then submit.'

// Where each field's error sends the keyboard focus.
const FIELD_TARGETS: Record<keyof FormErrors, string> = {
  section: '.rc-picker__list input, .rc-picker__body button',
  // The exam type is fixed (Final); its only error is "already requested",
  // which the student resolves by choosing another course section.
  examType: '.rc-picker__list input, .rc-picker__body button',
  missedExamDate: '#ie-date',
  missedExamTime: '#ie-time',
  reason: '#ie-reason',
  proofNote: '#ie-proof',
}

// Incomplete Exam request form (student). The student's own course sections
// of the current term on the left; the exam, explanation and optional PDFs
// on the right. Submit uploads every selected PDF first and creates the
// request only when all of them are uploaded (see
// utils/incompleteExamSubmissionFlow.ts). The request stays In Progress; no
// AI evaluation is started from here.
function IncompleteExamForm() {
  const location = useLocation()
  const navigate = useNavigate()
  const profile = useStudentProfile()
  const { status, enrollments, linked, retry } = useIncompleteExamEnrollments()

  const [today] = useState(uaeToday)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  // Incomplete Exam requests are for final exams only; this is always sent.
  const examType: ExamType = INCOMPLETE_EXAM_TYPE
  const [missedExamDate, setMissedExamDate] = useState('')
  const [missedExamTime, setMissedExamTime] = useState('')
  const [reason, setReason] = useState('')
  const [proofNote, setProofNote] = useState('')
  const [entries, setEntries] = useState<ProofEntry<File>[]>([])
  const [fileMessages, setFileMessages] = useState<string[]>([])
  const [reservation, setReservation] = useState<UploadReservation | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<SubmittedRequest | null>(null)
  // Guards against a second submission before React re-renders the disabled
  // form (e.g. a fast double click) and against changing files mid-way.
  const submittingRef = useRef(false)
  const doneHeadingRef = useRef<HTMLHeadingElement>(null)

  const selected = enrollments.find((e) => e.key === selectedKey) ?? null

  const fromDetails = (location.state as { from?: string } | null)?.from === 'details'
  const back = fromDetails
    ? { to: serviceDetailsPath('incomplete-exam'), state: undefined, label: 'Back to Incomplete Exam details' }
    : { to: '/student', state: { scrollTo: CATALOG_ANCHOR_ID }, label: 'Back to Academic Requests' }

  const values: Partial<IncompleteExamFormValues> = {
    courseId: selected?.courseId ?? '',
    sectionId: selected?.sectionId ?? '',
    term: selected?.term ?? '',
    examType,
    missedExamDate,
    missedExamTime,
    reason,
    proofNote,
  }
  const validation = validateIncompleteExamForm(values, today)
  const duplicateExam = Boolean(selected && selected.openExamTypes.includes(examType))
  const shown: FormErrors = attempted ? { ...validation } : {}
  // The exam type is fixed (Final) and not shown; its only possible error,
  // "already requested", appears on the course section the student chose.
  if (duplicateExam) shown.examType = DUPLICATE_EXAM_MESSAGE
  const late = !validation.missedExamDate && missedExamDate !== '' && isLateSubmission(missedExamDate, today)

  useEffect(() => {
    if (submitted) doneHeadingRef.current?.focus()
  }, [submitted])

  // Leaving while documents upload would abandon the submission: ask first.
  useEffect(() => {
    if (!submitting) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [submitting])

  const changed = () => setSubmitError(null)

  const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const chosen = Array.from(input.files ?? [])
    input.value = ''   // the same file can be chosen again after removing it
    if (submittingRef.current || chosen.length === 0) return
    const messages: string[] = []
    const accepted: ProofEntry<File>[] = []
    for (const file of chosen) {
      const problem = await checkSelectedProof(file)
      if (problem) {
        messages.push(`${file.name}: ${PROOF_FILE_PROBLEM_MESSAGES[problem]}`)
        continue
      }
      const selection = checkProofSelection([...entries, ...accepted].map((e) => e.file).concat(file))
      if (selection) {
        messages.push(`${file.name}: ${PROOF_SELECTION_PROBLEM_MESSAGES[selection]}`)
        continue
      }
      accepted.push(proofEntryFor(file))
    }
    if (submittingRef.current) return
    setEntries((current) => [...current, ...accepted])
    setFileMessages(messages)
    changed()
  }

  const removeFile = (id: string) => {
    if (submittingRef.current) return
    setEntries((current) => current.filter((e) => e.id !== id))
    setFileMessages([])
    changed()
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current) return
    setAttempted(true)
    setSubmitError(null)

    const firstError = (Object.keys(FIELD_TARGETS) as (keyof FormErrors)[])
      .find((field) => validation[field] || (field === 'examType' && duplicateExam))
    if (firstError || !selected) {
      document.querySelector<HTMLElement>(FIELD_TARGETS[firstError ?? 'section'])?.focus()
      return
    }
    if (submissionBlocker(entries) === 'failed_files') {
      setSubmitError(FAILED_FILES_MESSAGE)
      return
    }
    const selection = checkProofSelection(entries.map((e) => e.file))
    if (selection) {
      setSubmitError(PROOF_SELECTION_PROBLEM_MESSAGES[selection])
      return
    }

    const form: IncompleteExamFormValues = {
      courseId: selected.courseId,
      sectionId: selected.sectionId,
      term: selected.term,
      examType,
      missedExamDate,
      missedExamTime,
      reason,
      proofNote,
    }

    submittingRef.current = true
    setSubmitting(true)
    try {
      const outcome = await submitIncompleteExam({ form, entries, reservation, onEntries: setEntries })
      setEntries(outcome.entries)
      setReservation(outcome.reservation)
      if (outcome.kind === 'submitted') {
        setSubmitted({
          id: outcome.requestId,
          title: `${selected.courseId}${selected.courseName ? ` ${selected.courseName}` : ''} · Section ${selected.sectionId}`,
          examType,
          documents: outcome.entries.length,
        })
        window.scrollTo(0, 0)
      } else if (outcome.kind === 'uploads_failed') {
        setSubmitError(FAILED_FILES_MESSAGE)
      } else {
        setSubmitError(SUBMIT_ERROR_MESSAGES[outcome.code])
      }
    } catch {
      setSubmitError(SUBMIT_ERROR_MESSAGES.unknown)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const uploading = entries.some((e) => e.status === 'uploading')

  return (
    <StudentLayout profile={profile} solidHeader>
      <div className="rc-page ie-page">
        <Link to={back.to} state={back.state} className="rc-page__back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M13.5 8.5 10 12l3.5 3.5" />
          </svg>
          {back.label}
        </Link>

        <div className="rc-page__intro">
          <h1 className="rc-page__title">Incomplete Exam Request</h1>
          <p className="rc-page__lede">
            Request an incomplete for a final exam you were unable to attend.
          </p>
        </div>

        {submitted ? (
          <section className="rc-done" role="status" aria-labelledby="ie-done-title">
            <div className="rc-done__body">
              <span className="rc-done__icon" aria-hidden="true">
                ✓
              </span>
              <h2 id="ie-done-title" ref={doneHeadingRef} tabIndex={-1} className="rc-done__title">
                Request submitted
              </h2>
              <p className="rc-done__text">
                Your Incomplete Exam request for the <strong>{submitted.examType} Exam</strong> of{' '}
                <strong>{submitted.title}</strong> has been sent to the Registrar’s Office for review
                {submitted.documents > 0
                  ? `, with ${submitted.documents} supporting document${submitted.documents === 1 ? '' : 's'}.`
                  : ', without supporting documents.'}
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
        ) : status === 'ready' && !linked ? (
          <p className="rc-alert" role="alert">
            <span aria-hidden="true">✕ </span>
            This account is not linked to a student record, so an Incomplete Exam request cannot be submitted.
          </p>
        ) : (
          <form onSubmit={handleSubmit} noValidate aria-busy={submitting || undefined}>
            <fieldset className="rc-page__columns ie-fieldset" disabled={submitting}>
              <legend className="student-visually-hidden">Incomplete Exam request</legend>
              <EnrollmentPicker
                status={status}
                enrollments={enrollments}
                onRetry={retry}
                selectedKey={selectedKey}
                onSelect={(key) => {
                  setSelectedKey(key)
                  changed()
                }}
                error={shown.section ?? shown.examType}
              />

              <section className="rc-panel rc-details" aria-labelledby="ie-details-title">
                <div className="rc-panel__title-row rc-details__head">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
                    strokeLinejoin="round" aria-hidden="true">
                    <path d="M7 3.5h7l4.5 4.5v12.5H7zM14 3.5V8h4.5M10 13h5.5M10 16.5h4" />
                  </svg>
                  <h2 id="ie-details-title" className="rc-panel__title">
                    Exam and Reason
                  </h2>
                </div>

                <div className="ie-row">
                  <div className="rc-field">
                    <label htmlFor="ie-date" className="rc-field__label">
                      Date of the missed exam <span className="rc-field__required" aria-hidden="true">*</span>
                      <span className="student-visually-hidden">(required)</span>
                    </label>
                    <input
                      id="ie-date"
                      type="date"
                      className="rc-field__input"
                      max={today}
                      value={missedExamDate}
                      onChange={(event) => {
                        setMissedExamDate(event.target.value)
                        changed()
                      }}
                      aria-invalid={shown.missedExamDate ? true : undefined}
                      aria-describedby={[shown.missedExamDate ? 'ie-date-err' : '', late ? 'ie-late' : '']
                        .filter(Boolean).join(' ') || undefined}
                    />
                    {shown.missedExamDate && (
                      <span id="ie-date-err" className="rc-error">
                        <span aria-hidden="true">✕ </span>
                        {shown.missedExamDate}
                      </span>
                    )}
                  </div>
                  <div className="rc-field">
                    <label htmlFor="ie-time" className="rc-field__label">
                      Time of the missed exam <span className="rc-field__required" aria-hidden="true">*</span>
                      <span className="student-visually-hidden">(required)</span>
                    </label>
                    <input
                      id="ie-time"
                      type="time"
                      className="rc-field__input"
                      value={missedExamTime}
                      onChange={(event) => {
                        setMissedExamTime(event.target.value)
                        changed()
                      }}
                      aria-invalid={shown.missedExamTime ? true : undefined}
                      aria-describedby={shown.missedExamTime ? 'ie-time-err' : undefined}
                    />
                    {shown.missedExamTime && (
                      <span id="ie-time-err" className="rc-error">
                        <span aria-hidden="true">✕ </span>
                        {shown.missedExamTime}
                      </span>
                    )}
                  </div>
                </div>

                {late && (
                  <p id="ie-late" className="ie-warning" role="note">
                    <span aria-hidden="true">⚠ </span>
                    This exam was more than {SUBMISSION_WINDOW_WORKING_DAYS} working days ago (Friday and Saturday are
                    not counted). You can still submit, but requests made after this period may not be accepted.
                  </p>
                )}

                <div className="rc-field">
                  <label htmlFor="ie-reason" className="rc-field__label">
                    Why did you miss the exam? <span className="rc-field__required" aria-hidden="true">*</span>
                    <span className="student-visually-hidden">(required)</span>
                  </label>
                  <span id="ie-reason-help" className="rc-field__help">
                    Explain what happened, in at least 20 characters.
                  </span>
                  <textarea
                    id="ie-reason"
                    className="rc-field__input"
                    rows={5}
                    maxLength={REASON_MAX_LENGTH}
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value)
                      changed()
                    }}
                    aria-invalid={shown.reason ? true : undefined}
                    aria-describedby={['ie-reason-help', 'ie-reason-count', shown.reason ? 'ie-reason-err' : '']
                      .filter(Boolean).join(' ')}
                  />
                  {shown.reason && (
                    <span id="ie-reason-err" className="rc-error">
                      <span aria-hidden="true">✕ </span>
                      {shown.reason}
                    </span>
                  )}
                  <span id="ie-reason-count" className="rc-field__count">
                    {reason.length} / {REASON_MAX_LENGTH}
                  </span>
                </div>

                <div className="rc-field">
                  <label htmlFor="ie-proof" className="rc-field__label">
                    Description of your evidence (optional)
                  </label>
                  <span id="ie-proof-help" className="rc-field__help">
                    For example: “Medical report from the hospital, dated the day of the exam.”
                  </span>
                  <textarea
                    id="ie-proof"
                    className="rc-field__input"
                    rows={2}
                    maxLength={PROOF_NOTE_MAX_LENGTH}
                    value={proofNote}
                    onChange={(event) => {
                      setProofNote(event.target.value)
                      changed()
                    }}
                    aria-invalid={shown.proofNote ? true : undefined}
                    aria-describedby={['ie-proof-help', 'ie-proof-count', shown.proofNote ? 'ie-proof-err' : '']
                      .filter(Boolean).join(' ')}
                  />
                  {shown.proofNote && (
                    <span id="ie-proof-err" className="rc-error">
                      <span aria-hidden="true">✕ </span>
                      {shown.proofNote}
                    </span>
                  )}
                  <span id="ie-proof-count" className="rc-field__count">
                    {proofNote.length} / {PROOF_NOTE_MAX_LENGTH}
                  </span>
                </div>

                <ProofFilesField
                  entries={entries}
                  messages={fileMessages}
                  onAdd={(event) => void addFiles(event)}
                  onRemove={removeFile}
                  locked={submitting}
                />

                {submitError && (
                  <p className="rc-alert" role="alert">
                    <span aria-hidden="true">✕ </span>
                    {submitError}
                  </p>
                )}

                <div className="rc-details__actions">
                  <button type="button" className="rc-button" onClick={() => navigate(back.to, { state: back.state })}>
                    Cancel
                  </button>
                  <button type="submit" className="rc-submit" aria-busy={submitting || undefined}>
                    {submitting ? (uploading ? 'Uploading documents…' : 'Submitting…') : 'Submit Request'}
                  </button>
                </div>
              </section>
            </fieldset>
          </form>
        )}
      </div>
    </StudentLayout>
  )
}

export default IncompleteExamForm

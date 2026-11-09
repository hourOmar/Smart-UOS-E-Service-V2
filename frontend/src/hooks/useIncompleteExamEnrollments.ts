import { useCallback, useEffect, useState } from 'react'
import {
  fetchMyIncompleteExamEnrollments,
  type IncompleteExamEnrollment,
} from '../services/incompleteExamSubmission'

type Status = 'loading' | 'ready' | 'error'

interface EnrollmentsState {
  status: Status
  enrollments: IncompleteExamEnrollment[]
  /** False when the account is not linked to a student record. */
  linked: boolean
}

// The signed-in student's own enrolments of the current term (for the
// Incomplete Exam form), with a retry after an error.
function useIncompleteExamEnrollments() {
  const [state, setState] = useState<EnrollmentsState>({ status: 'loading', enrollments: [], linked: true })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchMyIncompleteExamEnrollments()
      .then((enrollments) => {
        if (cancelled) return
        setState(enrollments === null
          ? { status: 'ready', enrollments: [], linked: false }
          : { status: 'ready', enrollments, linked: true })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', enrollments: [], linked: true })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading', enrollments: [], linked: true })
    setAttempt((count) => count + 1)
  }, [])

  return { ...state, retry }
}

export default useIncompleteExamEnrollments

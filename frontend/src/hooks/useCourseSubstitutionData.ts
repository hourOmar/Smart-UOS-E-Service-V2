import { useCallback, useEffect, useState } from 'react'
import { fetchCourses, hasStudentRecord, type CourseOption } from '../services/courseSubstitution'

type Status = 'loading' | 'ready' | 'error'

interface State {
  status: Status
  courses: CourseOption[]
  /** False when the account has no linked Student record. */
  isStudent: boolean
}

// The course list and the student-record check for the Course Substitution
// form. Both load together; retry() loads them again.
function useCourseSubstitutionData() {
  const [state, setState] = useState<State>({ status: 'loading', courses: [], isStudent: false })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchCourses(), hasStudentRecord()])
      .then(([courses, isStudent]) => {
        if (!cancelled) setState({ status: 'ready', courses, isStudent })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', courses: [], isStudent: false })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading', courses: [], isStudent: false })
    setAttempt((count) => count + 1)
  }, [])

  return { ...state, retry }
}

export default useCourseSubstitutionData

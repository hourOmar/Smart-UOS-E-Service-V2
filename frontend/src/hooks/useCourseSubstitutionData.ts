import { useCallback, useEffect, useState } from 'react'
import { fetchCourseSubstitutionOptions, type CourseSubstitutionOptions } from '../services/courseSubstitution'

type Status = 'loading' | 'ready' | 'error'

interface State {
  status: Status
  /** Set once loaded ('ready'); its own status says whether the form can be used. */
  options: CourseSubstitutionOptions | null
}

// The student's Course Substitution options (study-plan courses the student
// can choose). retry() loads them again, e.g. after a refusal that means they
// changed.
function useCourseSubstitutionData() {
  const [state, setState] = useState<State>({ status: 'loading', options: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchCourseSubstitutionOptions()
      .then((options) => {
        if (!cancelled) setState({ status: 'ready', options })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', options: null })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading', options: null })
    setAttempt((count) => count + 1)
  }, [])

  return { ...state, retry }
}

export default useCourseSubstitutionData

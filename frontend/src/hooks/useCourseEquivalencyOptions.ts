import { useCallback, useEffect, useState } from 'react'
import { fetchCourseEquivalencyOptions, type CourseEquivalencyOptions } from '../services/courseEquivalency'

type Status = 'loading' | 'ready' | 'error'

interface State {
  status: Status
  /** Set once loaded (status 'ready'); its own status says ok or why blocked. */
  options: CourseEquivalencyOptions | null
}

// The applicable program and course lists for the Course Equivalency form.
// retry() loads them again (also used after a refusal that means they changed).
function useCourseEquivalencyOptions() {
  const [state, setState] = useState<State>({ status: 'loading', options: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchCourseEquivalencyOptions()
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

export default useCourseEquivalencyOptions

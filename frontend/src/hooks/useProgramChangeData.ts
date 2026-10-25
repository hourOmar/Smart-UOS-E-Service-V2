import { useCallback, useEffect, useState } from 'react'
import {
  fetchColleges,
  fetchCurrentProgram,
  type College,
  type CurrentProgram,
} from '../services/programChange'

type Status = 'loading' | 'ready' | 'error'

interface State {
  status: Status
  colleges: College[]
  /** Null when the account has no linked Student record. */
  current: CurrentProgram | null
}

// Colleges with their programs, and the signed-in student's current program,
// for the Program Change form. Both load together; retry() loads them again.
function useProgramChangeData() {
  const [state, setState] = useState<State>({ status: 'loading', colleges: [], current: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchColleges(), fetchCurrentProgram()])
      .then(([colleges, current]) => {
        if (!cancelled) setState({ status: 'ready', colleges, current })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', colleges: [], current: null })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading', colleges: [], current: null })
    setAttempt((count) => count + 1)
  }, [])

  return { ...state, retry }
}

export default useProgramChangeData

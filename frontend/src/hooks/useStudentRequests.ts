import { useCallback, useEffect, useState } from 'react'
import {
  fetchStudentRequests,
  type StudentRequestRow,
} from '../services/studentRequests'

type Status = 'loading' | 'ready' | 'error'

interface RequestsState {
  status: Status
  requests: StudentRequestRow[]
}

// Loads the signed-in student's requests (newest first; optionally only
// the latest few), with a retry after an error.
function useStudentRequests(limit?: number) {
  const [state, setState] = useState<RequestsState>({
    status: 'loading',
    requests: [],
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    fetchStudentRequests(limit)
      .then((requests) => {
        if (!cancelled) setState({ status: 'ready', requests })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', requests: [] })
      })

    return () => {
      cancelled = true
    }
  }, [limit, attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading', requests: [] })
    setAttempt((count) => count + 1)
  }, [])

  return { ...state, retry }
}

export default useStudentRequests

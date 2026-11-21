import { useCallback, useEffect, useState } from 'react'
import { fetchAllRequestsFilterOptions, type AllRequestsFilterOptions } from '../services/adminRequests'

type Status = 'loading' | 'ready' | 'error'

// The values offered by the All Requests term, course and section filters,
// read once per visit (and again on Try again).
function useAllRequestsFilterOptions() {
  const [state, setState] = useState<{ attempt: number; status: Exclude<Status, 'loading'>; data: AllRequestsFilterOptions | null } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchAllRequestsFilterOptions()
      .then((data) => {
        if (!cancelled) setState({ attempt, status: 'ready', data })
      })
      .catch(() => {
        if (!cancelled) setState({ attempt, status: 'error', data: null })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  if (!state || state.attempt !== attempt) return { status: 'loading' as Status, options: null, retry }
  return { status: state.status as Status, options: state.data, retry }
}

export default useAllRequestsFilterOptions

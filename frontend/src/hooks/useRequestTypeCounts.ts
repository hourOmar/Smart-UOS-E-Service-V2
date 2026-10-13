import { useCallback, useEffect, useState } from 'react'
import { fetchRequestTypeCounts, type RequestTypeCount } from '../services/adminRequests'

interface CountsState {
  status: 'loading' | 'ready' | 'error'
  counts: RequestTypeCount[]
}

// Total and In Progress counts for each request type, with a retry.
function useRequestTypeCounts() {
  const [state, setState] = useState<CountsState>({ status: 'loading', counts: [] })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchRequestTypeCounts()
      .then((counts) => {
        if (!cancelled) setState({ status: 'ready', counts })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', counts: [] })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading', counts: [] })
    setAttempt((count) => count + 1)
  }, [])

  return { ...state, retry }
}

export default useRequestTypeCounts

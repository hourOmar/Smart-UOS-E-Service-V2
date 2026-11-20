import { useCallback, useEffect, useState } from 'react'
import { fetchPendingRequests, type PendingRequests } from '../services/adminRequests'

type Status = 'loading' | 'ready' | 'error'

interface Loaded {
  /** Which attempt this result belongs to. */
  attempt: number
  status: Exclude<Status, 'loading'>
  data: PendingRequests
}

const EMPTY: PendingRequests = { rows: [], total: 0 }

// The most recent In Progress requests for the admin home (no filter, no pages).
function usePendingRequests() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchPendingRequests()
      .then((data) => {
        if (!cancelled) setLoaded({ attempt, status: 'ready', data })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ attempt, status: 'error', data: EMPTY })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  if (!loaded || loaded.attempt !== attempt) return { status: 'loading' as Status, ...EMPTY, retry }
  return { status: loaded.status as Status, ...loaded.data, retry }
}

export default usePendingRequests

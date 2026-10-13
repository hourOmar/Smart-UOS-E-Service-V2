import { useCallback, useEffect, useState } from 'react'
import { fetchPendingRequests, type PendingPage } from '../services/adminRequests'

type Status = 'loading' | 'ready' | 'error'

interface Loaded {
  /** Which type/page/attempt this result belongs to. */
  key: string
  status: Exclude<Status, 'loading'>
  data: PendingPage
}

const EMPTY: Omit<PendingPage, 'page'> = { rows: [], total: 0 }

// One page of In Progress requests (optionally of one type). While a new
// type or page loads, the hook reports "loading".
function usePendingRequests(type: string | null, page: number) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  const key = `${type ?? ''}|${page}|${attempt}`

  useEffect(() => {
    let cancelled = false
    fetchPendingRequests(type, page)
      .then((data) => {
        if (!cancelled) setLoaded({ key, status: 'ready', data })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, status: 'error', data: { ...EMPTY, page } })
      })
    return () => {
      cancelled = true
    }
  }, [type, page, key])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  if (!loaded || loaded.key !== key) return { status: 'loading' as Status, ...EMPTY, page, retry }
  return { status: loaded.status as Status, ...loaded.data, retry }
}

export default usePendingRequests

import { useCallback, useEffect, useState } from 'react'
import { fetchTypeStatusCounts, type TypeStatusCounts } from '../services/adminRequests'

type Status = 'loading' | 'ready' | 'error'

interface Loaded {
  key: string
  status: Exclude<Status, 'loading'>
  counts: TypeStatusCounts | null
}

// Total and per-status counts for one request type, with a retry.
function useTypeStatusCounts(type: string | null) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  const key = `${type ?? ''}|${attempt}`

  useEffect(() => {
    if (!type) return
    let cancelled = false
    fetchTypeStatusCounts(type)
      .then((counts) => {
        if (!cancelled) setLoaded({ key, status: 'ready', counts })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, status: 'error', counts: null })
      })
    return () => {
      cancelled = true
    }
  }, [type, key])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  if (!loaded || loaded.key !== key) return { status: 'loading' as Status, counts: null, retry }
  return { status: loaded.status as Status, counts: loaded.counts, retry }
}

export default useTypeStatusCounts

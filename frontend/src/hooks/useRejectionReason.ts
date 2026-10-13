import { useCallback, useEffect, useState } from 'react'
import { fetchRejectionReason, type RejectionReason } from '../services/studentRequests'

type Status = 'loading' | 'ready' | 'error'

interface Loaded {
  forId: string
  status: Exclude<Status, 'loading'>
  reason: RejectionReason | null
}

// The saved explanation of a rejected Raise Capacity request, loaded only when
// `enabled`, with a retry after a loading failure.
function useRejectionReason(requestId: string | undefined, enabled: boolean) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!requestId || !enabled) return
    let cancelled = false
    fetchRejectionReason(requestId)
      .then((reason) => {
        if (!cancelled) setLoaded({ forId: requestId, status: 'ready', reason })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ forId: requestId, status: 'error', reason: null })
      })
    return () => {
      cancelled = true
    }
  }, [requestId, enabled, attempt])

  const retry = useCallback(() => {
    setLoaded(null)
    setAttempt((count) => count + 1)
  }, [])

  if (!requestId || !enabled || !loaded || loaded.forId !== requestId) {
    return { status: 'loading' as Status, reason: null, retry }
  }
  return { status: loaded.status as Status, reason: loaded.reason, retry }
}

export default useRejectionReason

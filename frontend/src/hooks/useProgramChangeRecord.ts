import { useCallback, useEffect, useState } from 'react'
import { fetchProgramChangeReviewRecord, type ProgramChangeRecordResult } from '../services/programChangeReview'

type Status = 'loading' | 'ready' | 'error'

interface Loaded {
  forId: string
  status: Exclude<Status, 'loading'>
  result: ProgramChangeRecordResult | null
}

// The request, Program_Change details and student of one Program Change
// request, read from the database directly, so they show even when the
// evaluation service fails.
function useProgramChangeRecord(requestId: string | undefined) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!requestId) return
    let cancelled = false
    fetchProgramChangeReviewRecord(requestId)
      .then((result) => {
        if (!cancelled) setLoaded({ forId: requestId, status: 'ready', result })
      })
      .catch(() => {
        if (cancelled) return
        setLoaded((prev) =>
          prev && prev.forId === requestId && prev.status === 'ready'
            ? prev
            : { forId: requestId, status: 'error', result: null },
        )
      })
    return () => {
      cancelled = true
    }
  }, [requestId, attempt])

  const retry = useCallback(() => {
    setLoaded(null)
    setAttempt((count) => count + 1)
  }, [])

  // Reloads while the current data stays on screen (e.g. after a decision).
  const refresh = useCallback(() => {
    setAttempt((count) => count + 1)
  }, [])

  if (!requestId) {
    return { status: 'ready' as Status, result: { kind: 'not-found' } as ProgramChangeRecordResult, retry, refresh }
  }
  if (!loaded || loaded.forId !== requestId) return { status: 'loading' as Status, result: null, retry, refresh }
  return { status: loaded.status as Status, result: loaded.result, retry, refresh }
}

export default useProgramChangeRecord

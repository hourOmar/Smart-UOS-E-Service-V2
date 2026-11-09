import { useCallback, useEffect, useState } from 'react'
import { fetchIncompleteExamDecision, type IncompleteExamDecisionView } from '../services/incompleteExamStudent'

type Status = 'loading' | 'ready' | 'error'

interface Loaded {
  forId: string
  status: Exclude<Status, 'loading'>
  decision: IncompleteExamDecisionView | null
}

// The final decision and explanation of the signed-in student's own decided
// Incomplete Exam request, loaded only when `enabled`, with a retry after a
// loading failure (as useProgramChangeDecision).
function useIncompleteExamDecision(requestId: string | undefined, enabled: boolean) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!requestId || !enabled) return
    let cancelled = false
    fetchIncompleteExamDecision(requestId)
      .then((decision) => {
        if (!cancelled) setLoaded({ forId: requestId, status: 'ready', decision })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ forId: requestId, status: 'error', decision: null })
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
    return { status: 'loading' as Status, decision: null, retry }
  }
  return { status: loaded.status as Status, decision: loaded.decision, retry }
}

export default useIncompleteExamDecision

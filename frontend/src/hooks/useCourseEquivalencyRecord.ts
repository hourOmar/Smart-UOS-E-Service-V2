import { useCallback, useEffect, useState } from 'react'
import { fetchCourseEquivalencyReviewRecord } from '../services/courseEquivalencyReview'
import type { CourseEquivalencyRecordResult } from '../utils/courseEquivalencyRecord'

type Status = 'loading' | 'ready' | 'error'

interface Loaded {
  forId: string
  status: Exclude<Status, 'loading'>
  result: CourseEquivalencyRecordResult | null
}

// The request, Course_Equivalency details, courses, student, linked Program Change and
// history and final decision of one Course Equivalency request, read from the database directly, so they show
// even when the evaluation service fails (as useIncompleteExamRecord).
function useCourseEquivalencyRecord(requestId: string | undefined) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!requestId) return
    let cancelled = false
    fetchCourseEquivalencyReviewRecord(requestId)
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
    return { status: 'ready' as Status, result: { kind: 'not-found' } as CourseEquivalencyRecordResult, retry, refresh }
  }
  if (!loaded || loaded.forId !== requestId) return { status: 'loading' as Status, result: null, retry, refresh }
  return { status: loaded.status as Status, result: loaded.result, retry, refresh }
}

export default useCourseEquivalencyRecord

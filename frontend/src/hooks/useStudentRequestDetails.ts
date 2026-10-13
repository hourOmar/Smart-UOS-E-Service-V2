import { useCallback, useEffect, useState } from 'react'
import {
  fetchStudentRequestDetails,
  type StudentRequestDetails,
} from '../services/studentRequests'

type Status = 'loading' | 'ready' | 'not-found' | 'error'

interface LoadedState {
  /** The request ID this result belongs to. */
  forId: string
  status: Exclude<Status, 'loading'>
  request: StudentRequestDetails | null
}

// Loads one of the signed-in student's requests. "not-found" covers both a
// request that does not exist and one belonging to another student.
function useStudentRequestDetails(requestId: string | undefined) {
  const [loaded, setLoaded] = useState<LoadedState | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!requestId) return
    let cancelled = false

    fetchStudentRequestDetails(requestId)
      .then((request) => {
        if (cancelled) return
        setLoaded(
          request
            ? { forId: requestId, status: 'ready', request }
            : { forId: requestId, status: 'not-found', request: null },
        )
      })
      .catch(() => {
        if (!cancelled) setLoaded({ forId: requestId, status: 'error', request: null })
      })

    return () => {
      cancelled = true
    }
  }, [requestId, attempt])

  const retry = useCallback(() => {
    setLoaded(null)
    setAttempt((count) => count + 1)
  }, [])

  if (!requestId) return { status: 'not-found' as Status, request: null, retry }
  if (!loaded || loaded.forId !== requestId) return { status: 'loading' as Status, request: null, retry }
  return { status: loaded.status as Status, request: loaded.request, retry }
}

export default useStudentRequestDetails

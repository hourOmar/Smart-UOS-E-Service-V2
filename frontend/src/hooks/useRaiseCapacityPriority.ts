import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../services/backendApi'
import { fetchPriorities, type PriorityState } from '../services/raiseCapacityPriority'

// While a check started elsewhere is running, the state is re-read this often...
const POLL_MS = 4000
// ...for at most this many times (about ten minutes, the backend's run timeout).
const MAX_POLLS = 150

type Status = 'loading' | 'ready' | 'error'

interface State {
  forKey: string
  status: Status
  data: PriorityState | null
  error: string | null
}

// The saved priority of ONE Raise Capacity request, for its review page.
// Read-only: it uses the same staff endpoint as the requests table (so both
// show the same saved result) and never starts or retries a priority check;
// checks are started from the request lists only. A read failure is reported
// as such, never as "no priority".
function useRaiseCapacityPriority(requestId: string | undefined) {
  const [attempt, setAttempt] = useState(0)
  const key = requestId ? `${requestId}#${attempt}` : ''
  const [state, setState] = useState<State | null>(null)

  useEffect(() => {
    if (!requestId) return
    let cancelled = false
    let timer: number | undefined
    let polls = 0

    const load = async () => {
      try {
        const [found] = await fetchPriorities([requestId])
        if (cancelled) return
        setState({ forKey: key, status: 'ready', data: found ?? null, error: null })
        if (found?.state === 'running' && polls < MAX_POLLS) {
          polls += 1
          timer = window.setTimeout(() => void load(), POLL_MS)
        }
      } catch (error) {
        if (cancelled) return
        setState({
          forKey: key,
          status: 'error',
          data: null,
          error: error instanceof ApiError ? error.message : 'The priority service could not be reached.',
        })
      }
    }

    void load()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [requestId, key])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  const current = state && state.forKey === key ? state : null
  return {
    status: current?.status ?? ('loading' as Status),
    data: current?.data ?? null,
    error: current?.error ?? null,
    retry,
  }
}

export type RaiseCapacityPriority = ReturnType<typeof useRaiseCapacityPriority>
export default useRaiseCapacityPriority

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  fetchEvaluation,
  requestEvaluation,
  type EvaluationState,
} from '../services/raiseCapacityReview'

// While any run is active, the saved state is re-read this often.
const POLL_MS = 4000
// ...for at most this many times (about five minutes).
const MAX_POLLS = 75

interface State {
  forId: string
  status: 'loading' | 'ready' | 'error'
  data: EvaluationState | null
  /** Why the saved state could not be loaded (only when there is no data). */
  error: string | null
  /** This page's own request to run the agent is in flight. */
  running: boolean
  /** A problem with the latest action, shown without hiding the saved result. */
  notice: string | null
}

const initial = (forId: string): State => ({
  forId, status: 'loading', data: null, error: null, running: false, notice: null,
})

const messageOf = (error: unknown) =>
  error instanceof ApiError ? error.message : 'The eligibility service could not be reached.'

// Eligibility evaluation for the review page:
// - loads the saved state (never runs the agent);
// - asks for the first run ONLY when the request has never been evaluated AND
//   is In Progress (`autoRun`: true), once per request per page (the backend
//   also refuses duplicates). While the request's status is unknown
//   (`autoRun`: null) it waits; for finalized requests (false) it never runs;
// - while a run is active (this page's or anyone else's), re-reads the saved
//   state until it finishes, without starting another;
// - rerun() runs again on request.
function useEligibilityEvaluation(requestId: string | undefined, autoRun: boolean | null) {
  const [state, setState] = useState<State | null>(null)
  const [attempt, setAttempt] = useState(0)
  const autoRequested = useRef(new Set<string>())
  const runRef = useRef<((rerun: boolean) => Promise<void>) | null>(null)

  useEffect(() => {
    if (!requestId) return
    let cancelled = false
    let timer: number | undefined

    const update = (patch: Partial<State> | ((prev: State) => Partial<State>)) => {
      if (cancelled) return
      setState((prev) => {
        const base = prev && prev.forId === requestId ? prev : initial(requestId)
        return { ...base, ...(typeof patch === 'function' ? patch(base) : patch) }
      })
    }

    const poll = (count: number) => {
      if (count >= MAX_POLLS) {
        update({ notice: 'The eligibility check is taking longer than expected. Reload the page later.' })
        return
      }
      timer = window.setTimeout(() => void load(count + 1), POLL_MS)
    }

    const run = async (rerun: boolean) => {
      update({ running: true, notice: null })
      try {
        const data = await requestEvaluation(requestId, rerun)
        if (cancelled) return
        update({ status: 'ready', data, error: null, running: false })
        if (data.in_progress) poll(0)
      } catch (error) {
        if (cancelled) return
        update({ running: false, notice: messageOf(error) })
        if (error instanceof ApiError && error.status === 409) poll(0)
      }
    }

    const load = async (count: number) => {
      try {
        const data = await fetchEvaluation(requestId)
        if (cancelled) return
        update({ status: 'ready', data, error: null })
        if (data.in_progress) poll(count)
        // The first run (if any) is started by the effect below.
      } catch (error) {
        if (cancelled) return
        // Keep a result already on screen; report the problem beside it.
        update((prev) =>
          prev.data ? { notice: messageOf(error) } : { status: 'error', error: messageOf(error) },
        )
      }
    }

    runRef.current = run
    void load(0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [requestId, attempt])

  // First run: only once the saved state shows no evaluation at all and the
  // request is known to be In Progress. Finalized requests are never run
  // automatically (staff can still use Re-run).
  const neverEvaluated =
    state !== null &&
    Boolean(requestId) &&
    state.forId === requestId &&
    state.status === 'ready' &&
    state.data?.run_count === 0 &&
    !state.data.in_progress &&
    !state.running
  useEffect(() => {
    if (!requestId || autoRun !== true || !neverEvaluated || autoRequested.current.has(requestId)) return
    autoRequested.current.add(requestId)
    void runRef.current?.(false)
  }, [requestId, autoRun, neverEvaluated])

  const rerun = useCallback(() => {
    void runRef.current?.(true)
  }, [])

  const retry = useCallback(() => {
    setState(null)
    setAttempt((count) => count + 1)
  }, [])

  const current = state && requestId && state.forId === requestId ? state : requestId ? initial(requestId) : null
  return {
    status: current?.status ?? 'loading',
    data: current?.data ?? null,
    error: current?.error ?? null,
    running: current?.running ?? false,
    notice: current?.notice ?? null,
    rerun,
    retry,
  }
}

export default useEligibilityEvaluation

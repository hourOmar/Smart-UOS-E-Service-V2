import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  fetchProgramChangeEvaluation,
  requestProgramChangeEvaluation,
  type ProgramChangeEvaluationState,
} from '../services/programChangeReview'

// While any run is active, the saved state is re-read this often.
const POLL_MS = 4000
// ...for at most this many times (about five minutes).
const MAX_POLLS = 75

interface State {
  forId: string
  status: 'loading' | 'ready' | 'error'
  data: ProgramChangeEvaluationState | null
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
  error instanceof ApiError ? error.message : 'The Program Change evaluation service could not be reached.'

// Program Change evaluation for the review page (same pattern as
// useEligibilityEvaluation for Raise Capacity):
// - loads the saved state (GET never runs the agent);
// - asks for the first run ONLY when the API reports auto_run_eligible (never
//   evaluated AND In Progress), once per request per page; the backend also
//   refuses duplicates under a lock;
// - while a run is active (this page's or anyone else's), re-reads the saved
//   state until it finishes, without starting another;
// - run(rerun) on request: rerun=false for a first evaluation, true to
//   evaluate again (the backend allows it only while In Progress).
function useProgramChangeEvaluation(requestId: string | undefined) {
  const [state, setState] = useState<State | null>(null)
  const [attempt, setAttempt] = useState(0)
  const autoRequested = useRef(new Set<string>())
  const runRef = useRef<((rerun: boolean) => Promise<void>) | null>(null)

  useEffect(() => {
    if (!requestId) return
    let cancelled = false
    let timer: number | undefined
    // Guards against a second run request before React re-renders.
    let inFlight = false

    const update = (patch: Partial<State> | ((prev: State) => Partial<State>)) => {
      if (cancelled) return
      setState((prev) => {
        const base = prev && prev.forId === requestId ? prev : initial(requestId)
        return { ...base, ...(typeof patch === 'function' ? patch(base) : patch) }
      })
    }

    const poll = (count: number) => {
      window.clearTimeout(timer)
      if (count >= MAX_POLLS) {
        update({ notice: 'The evaluation is taking longer than expected. Reload the page later.' })
        return
      }
      timer = window.setTimeout(() => void load(count + 1), POLL_MS)
    }

    const load = async (count: number) => {
      try {
        const data = await fetchProgramChangeEvaluation(requestId)
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

    const run = async (rerun: boolean) => {
      if (inFlight) return
      inFlight = true
      window.clearTimeout(timer)
      update({ running: true, notice: null })
      try {
        const data = await requestProgramChangeEvaluation(requestId, rerun)
        if (cancelled) return
        update({ status: 'ready', data, error: null, running: false })
        if (data.in_progress) poll(0)
      } catch (error) {
        if (cancelled) return
        update({ running: false, notice: messageOf(error) })
        // Show the real state: a run may be going on (409), or may have
        // started before the connection failed.
        void load(0)
      } finally {
        inFlight = false
      }
    }

    runRef.current = run
    // A reload cancels the previous effect, including this page's own run
    // request; a run still going on shows through the saved state
    // (in_progress) instead.
    update({ running: false })
    void load(0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [requestId, attempt])

  // First run: only when the saved state says the API allows it.
  const autoEligible =
    state !== null &&
    Boolean(requestId) &&
    state.forId === requestId &&
    state.status === 'ready' &&
    state.data?.auto_run_eligible === true &&
    !state.data.in_progress &&
    !state.running
  useEffect(() => {
    if (!requestId || !autoEligible || autoRequested.current.has(requestId)) return
    autoRequested.current.add(requestId)
    void runRef.current?.(false)
  }, [requestId, autoEligible])

  const run = useCallback((rerun: boolean) => {
    void runRef.current?.(rerun)
  }, [])

  const retry = useCallback(() => {
    setState(null)
    setAttempt((count) => count + 1)
  }, [])

  // Reloads the saved state while the current one stays on screen (after a
  // decision, so a finalized request no longer offers a re-run). Never runs
  // the agent: the first run only starts when the API allows it, once.
  const refresh = useCallback(() => {
    setAttempt((count) => count + 1)
  }, [])

  const current = state && requestId && state.forId === requestId ? state : requestId ? initial(requestId) : null
  return {
    status: current?.status ?? 'loading',
    data: current?.data ?? null,
    error: current?.error ?? null,
    running: current?.running ?? false,
    notice: current?.notice ?? null,
    run,
    retry,
    refresh,
  }
}

export default useProgramChangeEvaluation

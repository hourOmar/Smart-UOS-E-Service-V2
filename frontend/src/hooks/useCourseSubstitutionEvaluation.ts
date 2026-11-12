import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  fetchCourseSubstitutionEvaluation,
  requestCourseSubstitutionEvaluation,
  type CourseSubstitutionEvaluationState,
} from '../services/courseSubstitutionReview'
import { canStartFirstEvaluation, canStartReevaluation } from '../utils/courseSubstitutionEvaluation'

// While any run is active, the saved state is re-read this often...
const POLL_MS = 4000
// ...for at most this many times (about five minutes).
const MAX_POLLS = 75

interface State {
  forId: string
  status: 'loading' | 'ready' | 'error'
  data: CourseSubstitutionEvaluationState | null
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
  error instanceof ApiError ? error.message : 'The Course Substitution evaluation service could not be reached.'

// Course Substitution evaluation for the review page. Same pattern as
// useIncompleteExamEvaluation: there is NO automatic first run. Opening the
// page only loads the saved state (GET never runs the agent); the agent --
// which sends the request to Gemini -- runs only when staff call run():
// - run(false): the first evaluation, only when the saved state allows it
//   (auto_run_eligible: never evaluated, In Progress, details present);
// - run(true): evaluate again, only when the saved state allows it (can_rerun);
// - while a run is active (this page's or anyone else's), the saved state is
//   re-read every POLL_MS until it finishes, at most MAX_POLLS times, without
//   starting another. The backend also refuses duplicates under a lock.
function useCourseSubstitutionEvaluation(requestId: string | undefined) {
  const [state, setState] = useState<State | null>(null)
  const [attempt, setAttempt] = useState(0)
  const runRef = useRef<((rerun: boolean) => Promise<void>) | null>(null)
  const stateRef = useRef<State | null>(null)

  useEffect(() => {
    stateRef.current = state
  }, [state])

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
        const data = await fetchCourseSubstitutionEvaluation(requestId)
        if (cancelled) return
        update({ status: 'ready', data, error: null })
        if (data.in_progress) poll(count)
      } catch (error) {
        if (cancelled) return
        // Keep a result already on screen; report the problem beside it.
        update((prev) => (prev.data ? { notice: messageOf(error) } : { status: 'error', error: messageOf(error) }))
      }
    }

    const run = async (rerun: boolean) => {
      if (inFlight) return
      inFlight = true
      window.clearTimeout(timer)
      update({ running: true, notice: null })
      try {
        const data = await requestCourseSubstitutionEvaluation(requestId, rerun)
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
    void load(0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [requestId, attempt])

  /** Staff action only. Ignored unless the saved state allows that run now. */
  const run = useCallback((rerun: boolean) => {
    const current = stateRef.current
    if (!current || current.status !== 'ready') return
    const allowed = rerun
      ? canStartReevaluation(current.data, current.running)
      : canStartFirstEvaluation(current.data, current.running)
    if (!allowed) return
    void runRef.current?.(rerun)
  }, [])

  const retry = useCallback(() => {
    setState(null)
    setAttempt((count) => count + 1)
  }, [])

  // Reloads the saved state while the current one stays on screen (after a
  // decision, so a finalized request no longer offers a re-run). Never runs
  // the agent.
  const refresh = useCallback(() => {
    setAttempt((count) => count + 1)
  }, [])

  const current = state && requestId && state.forId === requestId ? state : requestId ? initial(requestId) : null
  const data = current?.data ?? null
  const running = current?.running ?? false
  return {
    status: current?.status ?? 'loading',
    data,
    error: current?.error ?? null,
    running,
    notice: current?.notice ?? null,
    canStartFirst: current?.status === 'ready' && canStartFirstEvaluation(data, running),
    canRerun: current?.status === 'ready' && canStartReevaluation(data, running),
    run,
    retry,
    refresh,
  }
}

export default useCourseSubstitutionEvaluation

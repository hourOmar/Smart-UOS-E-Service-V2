import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  fetchCourseEquivalencyEvaluation,
  requestCourseEquivalencyEvaluation,
} from '../services/courseEquivalencyReview'
import {
  canStartFirstEvaluation,
  canStartReevaluation,
  shouldAutoRun,
  type CourseEquivalencyEvaluationState,
} from '../utils/courseEquivalencyEvaluation'

// While any run is active, the saved state is re-read this often...
const POLL_MS = 4000
// ...for at most this many times (about five minutes).
const MAX_POLLS = 75

interface State {
  forId: string
  status: 'loading' | 'ready' | 'error'
  data: CourseEquivalencyEvaluationState | null
  /** Why the saved state could not be loaded (only when there is no data). */
  error: string | null
  /** This page's own request to run the agents is in flight. */
  running: boolean
  /** A problem with the latest action, shown without hiding the saved result. */
  notice: string | null
}

const initial = (forId: string): State => ({
  forId, status: 'loading', data: null, error: null, running: false, notice: null,
})

const messageOf = (error: unknown) =>
  error instanceof ApiError ? error.message : 'The Course Equivalency evaluation service could not be reached.'

// Course Equivalency evaluation for the review page (same pattern as
// useProgramChangeEvaluation):
// - loads the saved state (GET never runs the agents);
// - asks for the FIRST run automatically ONLY when the API reports auto_run_eligible (never
//   evaluated, In Progress, details and both syllabi present, and not both syllabi legacy
//   imports), at most once per request on this page (shouldAutoRun); the backend also refuses
//   duplicates under a lock. Legacy-only requests wait for staff to select Run Evaluation;
// - while a run is active (this page's or anyone else's), re-reads the saved state until it
//   finishes, without starting another;
// - run(true) re-evaluates only when the saved state allows it (can_rerun);
// - refresh() re-reads the saved state (e.g. after a syllabus upload, which can make the
//   request eligible or mark the saved result outdated) without hiding what is shown.
function useCourseEquivalencyEvaluation(requestId: string | undefined) {
  const [state, setState] = useState<State | null>(null)
  const [attempt, setAttempt] = useState(0)
  const autoRequested = useRef(new Set<string>())
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
        const data = await fetchCourseEquivalencyEvaluation(requestId)
        if (cancelled) return
        update({ status: 'ready', data, error: null })
        if (data.in_progress) poll(count)
      } catch (error) {
        if (cancelled) return
        update((prev) => (prev.data ? { notice: messageOf(error) } : { status: 'error', error: messageOf(error) }))
      }
    }

    const run = async (rerun: boolean) => {
      if (inFlight) return
      inFlight = true
      window.clearTimeout(timer)
      update({ running: true, notice: null })
      try {
        const data = await requestCourseEquivalencyEvaluation(requestId, rerun)
        if (cancelled) return
        update({ status: 'ready', data, error: null, running: false })
        if (data.in_progress) poll(0)
      } catch (error) {
        if (cancelled) return
        update({ running: false, notice: messageOf(error) })
        // Show the real state: a run may be going on (409), or may have started before the
        // connection failed.
        void load(0)
      } finally {
        inFlight = false
      }
    }

    runRef.current = run
    update({ running: false })
    void load(0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [requestId, attempt])

  // First run: automatically, once, only when the saved state says the API allows it.
  const current = state && requestId && state.forId === requestId ? state : null
  const autoEligible = Boolean(
    requestId && current && current.status === 'ready' &&
      shouldAutoRun(requestId, current.data, current.running, autoRequested.current),
  )
  useEffect(() => {
    if (!requestId || !autoEligible || autoRequested.current.has(requestId)) return
    autoRequested.current.add(requestId)
    void runRef.current?.(false)
  }, [requestId, autoEligible])

  /** Staff action only. Ignored unless the saved state allows that run now. */
  const run = useCallback((rerun: boolean) => {
    const now = stateRef.current
    if (!now || now.status !== 'ready') return
    const allowed = rerun ? canStartReevaluation(now.data, now.running) : canStartFirstEvaluation(now.data, now.running)
    if (!allowed) return
    if (!rerun && requestId) autoRequested.current.add(requestId)
    void runRef.current?.(rerun)
  }, [requestId])

  const retry = useCallback(() => {
    setState(null)
    setAttempt((count) => count + 1)
  }, [])

  const refresh = useCallback(() => {
    setAttempt((count) => count + 1)
  }, [])

  const shown = current ?? (requestId ? initial(requestId) : null)
  const data = shown?.data ?? null
  const running = shown?.running ?? false
  return {
    status: shown?.status ?? 'loading',
    data,
    error: shown?.error ?? null,
    running,
    notice: shown?.notice ?? null,
    canStartFirst: shown?.status === 'ready' && canStartFirstEvaluation(data, running),
    canRerun: shown?.status === 'ready' && canStartReevaluation(data, running),
    run,
    retry,
    refresh,
  }
}

export default useCourseEquivalencyEvaluation

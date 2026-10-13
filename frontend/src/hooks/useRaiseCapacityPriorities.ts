import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../services/backendApi'
import {
  fetchPriorities,
  retryPriority,
  startAutomaticPriorities,
  type PriorityState,
} from '../services/raiseCapacityPriority'

// While a check is running (or waiting for a free slot), states are re-read this often...
const POLL_MS = 4000
// ...for at most this many times (about ten minutes, the backend's run timeout).
const MAX_POLLS = 150

type Status = 'idle' | 'loading' | 'ready' | 'unavailable'

interface State {
  forKey: string
  status: Status
  byId: Record<string, PriorityState>
  /** Shown beside the table; never replaces a saved priority. */
  notice: string | null
  retrying: Record<string, boolean>
  retryErrors: Record<string, string>
}

const initial = (forKey: string): State => ({
  forKey, status: 'loading', byId: {}, notice: null, retrying: {}, retryErrors: {},
})

const needsPolling = (states: PriorityState[]) =>
  states.some((s) => s.state === 'running' || s.auto_eligible)

// Priorities for the Raise Capacity requests visible in an admin table:
// - reads the saved states first (never runs anything), so reopening a page
//   reuses saved priorities;
// - asks the backend to start checks only when it reports a request as
//   eligible (In Progress, no saved priority, never checked); the backend
//   decides and refuses duplicates;
// - re-reads while checks run, and calls "automatic" again for requests still
//   waiting for a free slot;
// - a failed read stops everything and shows "unavailable" until the admin
//   chooses Try again; failed checks are retried only by the admin (retry()).
function useRaiseCapacityPriorities(requestIds: string[]) {
  const key = requestIds.join('|')
  const [attempt, setAttempt] = useState(0)
  const stateKey = `${key}#${attempt}`
  const [state, setState] = useState<State | null>(null)
  const kickRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const ids = key ? key.split('|') : []
    if (ids.length === 0) return
    let cancelled = false
    let timer: number | undefined
    let polls = 0

    const update = (patch: Partial<State> | ((prev: State) => Partial<State>)) => {
      if (cancelled) return
      setState((prev) => {
        const base = prev && prev.forKey === stateKey ? prev : initial(stateKey)
        return { ...base, ...(typeof patch === 'function' ? patch(base) : patch) }
      })
    }
    const merge = (states: PriorityState[]) => (prev: State) => ({
      byId: { ...prev.byId, ...Object.fromEntries(states.map((s) => [s.request_id, s])) },
    })

    const schedule = () => {
      if (cancelled || timer !== undefined) return
      if (polls >= MAX_POLLS) {
        update({ notice: 'Some priority checks are taking longer than expected. Reload the page later.' })
        return
      }
      polls += 1
      timer = window.setTimeout(() => {
        timer = undefined
        void tick()
      }, POLL_MS)
    }

    const tick = async () => {
      try {
        let states = await fetchPriorities(ids)
        if (cancelled) return
        update((prev) => ({ ...merge(states)(prev), status: 'ready' }))
        const eligible = states.filter((s) => s.auto_eligible).map((s) => s.request_id)
        if (eligible.length > 0) {
          const started = await startAutomaticPriorities(eligible)
          if (cancelled) return
          update(merge(started))
          const startedById = new Map(started.map((s) => [s.request_id, s]))
          states = states.map((s) => startedById.get(s.request_id) ?? s)
        }
        if (needsPolling(states)) schedule()
      } catch (error) {
        if (cancelled) return
        // Never treated as "no priority"; nothing is retried automatically.
        update({
          status: 'unavailable',
          notice: error instanceof ApiError ? error.message : 'The priority service could not be reached.',
        })
      }
    }

    kickRef.current = schedule
    void tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      kickRef.current = null
    }
  }, [key, stateKey])

  const current = state && state.forKey === stateKey ? state : null

  const retry = useCallback(
    async (requestId: string) => {
      const forKey = stateKey
      const patch = (fn: (prev: State) => Partial<State>) =>
        setState((prev) => (prev && prev.forKey === forKey ? { ...prev, ...fn(prev) } : prev))
      patch((prev) => ({
        retrying: { ...prev.retrying, [requestId]: true },
        retryErrors: { ...prev.retryErrors, [requestId]: '' },
      }))
      try {
        const next = await retryPriority(requestId)
        patch((prev) => ({
          byId: { ...prev.byId, [requestId]: next },
          retrying: { ...prev.retrying, [requestId]: false },
        }))
      } catch (error) {
        patch((prev) => ({
          retrying: { ...prev.retrying, [requestId]: false },
          retryErrors: {
            ...prev.retryErrors,
            [requestId]: error instanceof ApiError ? error.message : 'The priority service could not be reached.',
          },
        }))
      }
      // Follow the new run, or show what changed meanwhile.
      kickRef.current?.()
    },
    [stateKey],
  )

  const reload = useCallback(() => {
    setState(null)
    setAttempt((count) => count + 1)
  }, [])

  return {
    status: (key ? (current?.status ?? 'loading') : 'idle') as Status,
    byId: current?.byId ?? {},
    notice: current?.notice ?? null,
    retrying: current?.retrying ?? {},
    retryErrors: current?.retryErrors ?? {},
    retry,
    reload,
  }
}

export type RaiseCapacityPriorities = ReturnType<typeof useRaiseCapacityPriorities>
export default useRaiseCapacityPriorities

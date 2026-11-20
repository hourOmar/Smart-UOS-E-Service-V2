import { useCallback, useEffect, useState } from 'react'
import { fetchAllRequests, type AllRequestsPage } from '../services/adminRequests'
import type { AllRequestsFilters } from '../utils/adminAllRequests'

type Status = 'idle' | 'loading' | 'ready' | 'error'

interface Loaded {
  /** Which filters/attempt this result belongs to. */
  key: string
  status: 'ready' | 'error'
  data: AllRequestsPage
}

// One page of the All Requests list for these filters. While new filters load,
// the hook reports "loading"; with enabled false (e.g. an impossible date
// range) nothing is fetched.
function useAllRequests(filters: AllRequestsFilters, enabled = true) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  const filtersKey = JSON.stringify(filters)
  const key = `${filtersKey}#${attempt}`

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetchAllRequests(JSON.parse(filtersKey) as AllRequestsFilters)
      .then((data) => {
        if (!cancelled) setLoaded({ key, status: 'ready', data })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, status: 'error', data: { rows: [], total: 0, page: 1 } })
      })
    return () => {
      cancelled = true
    }
  }, [enabled, filtersKey, key])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  const empty = { rows: [], total: 0, page: filters.page }
  if (!enabled) return { status: 'idle' as Status, ...empty, retry }
  if (!loaded || loaded.key !== key) return { status: 'loading' as Status, ...empty, retry }
  return { status: loaded.status as Status, ...loaded.data, retry }
}

export default useAllRequests

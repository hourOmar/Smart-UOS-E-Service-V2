import { useCallback, useEffect, useState } from 'react'
import { fetchAllRequests, type AllRequestsPage } from '../services/adminRequests'
import { AllRequestsFilterError, type AllRequestsFilters } from '../utils/adminAllRequests'

type Status = 'idle' | 'loading' | 'ready' | 'error'

interface Loaded {
  /** Which filters/attempt this result belongs to. */
  key: string
  status: 'ready' | 'error'
  data: AllRequestsPage
  /** A filter that could not be applied (shown as is); null for other errors. */
  filterError: string | null
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
        if (!cancelled) setLoaded({ key, status: 'ready', data, filterError: null })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoaded({
          key,
          status: 'error',
          data: { rows: [], total: 0, page: 1 },
          filterError: error instanceof AllRequestsFilterError ? error.message : null,
        })
      })
    return () => {
      cancelled = true
    }
  }, [enabled, filtersKey, key])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  const empty = { rows: [], total: 0, page: filters.page, filterError: null }
  if (!enabled) return { status: 'idle' as Status, ...empty, retry }
  if (!loaded || loaded.key !== key) return { status: 'loading' as Status, ...empty, retry }
  return { status: loaded.status as Status, ...loaded.data, filterError: loaded.filterError, retry }
}

export default useAllRequests

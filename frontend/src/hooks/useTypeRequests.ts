import { useCallback, useEffect, useState } from 'react'
import { fetchTypeRequests, type TypeRequestRow } from '../services/adminRequests'
import { AllRequestsFilterError } from '../utils/adminAllRequests'
import { EMPTY_TYPE_FILTERS, type TypeFilters } from '../utils/adminTypeFilters'

type Status = 'loading' | 'ready' | 'error'

interface Loaded {
  key: string
  status: Exclude<Status, 'loading'>
  rows: TypeRequestRow[]
  total: number
  /** The page shown (lower than requested if that page no longer exists). */
  page: number
  /** A filter that could not be applied (shown as is); null for other errors. */
  filterError: string | null
}

// One page of a request type's list for the current status tab, search and
// additional filters. While a new page, tab, search or filter loads, the hook
// reports "loading".
function useTypeRequests(
  type: string | null,
  status: string | null,
  search: string,
  page: number,
  filters: TypeFilters = EMPTY_TYPE_FILTERS,
) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  const filtersKey = JSON.stringify(filters)
  const key = `${type ?? ''}|${status ?? ''}|${search}|${page}|${filtersKey}|${attempt}`

  useEffect(() => {
    if (!type) return
    let cancelled = false
    fetchTypeRequests({ type, status, search, page, filters: JSON.parse(filtersKey) as TypeFilters })
      .then((result) => {
        if (!cancelled) setLoaded({ key, status: 'ready', ...result, filterError: null })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoaded({
          key,
          status: 'error',
          rows: [],
          total: 0,
          page,
          filterError: error instanceof AllRequestsFilterError ? error.message : null,
        })
      })
    return () => {
      cancelled = true
    }
  }, [type, status, search, page, filtersKey, key])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  if (!loaded || loaded.key !== key) {
    return { status: 'loading' as Status, rows: [] as TypeRequestRow[], total: 0, page, filterError: null, retry }
  }
  return {
    status: loaded.status as Status,
    rows: loaded.rows,
    total: loaded.total,
    page: loaded.page,
    filterError: loaded.filterError,
    retry,
  }
}

export default useTypeRequests

import { useCallback, useEffect, useState } from 'react'
import { fetchTypeRequests, type TypeRequestRow } from '../services/adminRequests'

type Status = 'loading' | 'ready' | 'error'

interface Loaded {
  key: string
  status: Exclude<Status, 'loading'>
  rows: TypeRequestRow[]
  total: number
  /** The page shown (lower than requested if that page no longer exists). */
  page: number
}

// One page of a request type's list for the current status tab and search.
// While a new page, tab or search loads, the hook reports "loading".
function useTypeRequests(type: string | null, status: string | null, search: string, page: number) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  const key = `${type ?? ''}|${status ?? ''}|${search}|${page}|${attempt}`

  useEffect(() => {
    if (!type) return
    let cancelled = false
    fetchTypeRequests({ type, status, search, page })
      .then((result) => {
        if (!cancelled) setLoaded({ key, status: 'ready', ...result })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, status: 'error', rows: [], total: 0, page })
      })
    return () => {
      cancelled = true
    }
  }, [type, status, search, page, key])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  if (!loaded || loaded.key !== key) {
    return { status: 'loading' as Status, rows: [] as TypeRequestRow[], total: 0, page, retry }
  }
  return { status: loaded.status as Status, rows: loaded.rows, total: loaded.total, page: loaded.page, retry }
}

export default useTypeRequests

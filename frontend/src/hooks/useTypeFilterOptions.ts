import { useCallback, useEffect, useState } from 'react'
import { fetchTypeFilterOptions, type TypeFilterOptions } from '../services/adminRequests'

type Status = 'loading' | 'ready' | 'error'

// The values offered by a request type's additional filters, read once per
// visit of that type's list (and again on Try again).
function useTypeFilterOptions(type: string) {
  const [state, setState] = useState<{ key: string; status: Exclude<Status, 'loading'>; data: TypeFilterOptions | null } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const key = `${type}#${attempt}`

  useEffect(() => {
    let cancelled = false
    fetchTypeFilterOptions(type)
      .then((data) => {
        if (!cancelled) setState({ key, status: 'ready', data })
      })
      .catch(() => {
        if (!cancelled) setState({ key, status: 'error', data: null })
      })
    return () => {
      cancelled = true
    }
  }, [type, key])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  if (!state || state.key !== key) return { status: 'loading' as Status, options: null, retry }
  return { status: state.status as Status, options: state.data, retry }
}

export default useTypeFilterOptions

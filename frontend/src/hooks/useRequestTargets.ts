import { useEffect, useState } from 'react'
import { fetchRequestTargets, type StudentRequestRow } from '../services/studentRequests'

interface TargetsState {
  requests: StudentRequestRow[] | null
  targets: Map<string, string> | null
}

// The course or program of each listed request, once they have loaded
// (null until then). The column is supplementary: if it cannot be read, the
// requests are still listed and their Course / Program cells show "—".
function useRequestTargets(requests: StudentRequestRow[] | null) {
  const [state, setState] = useState<TargetsState>({ requests: null, targets: null })

  useEffect(() => {
    if (!requests || requests.length === 0) return
    let cancelled = false

    fetchRequestTargets(requests)
      .then((targets) => {
        if (!cancelled) setState({ requests, targets })
      })
      .catch(() => {
        if (!cancelled) setState({ requests, targets: new Map() })
      })

    return () => {
      cancelled = true
    }
  }, [requests])

  return state.requests === requests ? state.targets : null
}

export default useRequestTargets

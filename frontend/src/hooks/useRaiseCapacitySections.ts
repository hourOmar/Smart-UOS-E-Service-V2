import { useCallback, useEffect, useState } from 'react'
import {
  fetchRaiseCapacitySections,
  type RaiseCapacitySection,
} from '../services/raiseCapacity'

type Status = 'loading' | 'ready' | 'error'

interface SectionsState {
  status: Status
  sections: RaiseCapacitySection[]
}

// Loads the current term's sections, with a retry after an error.
function useRaiseCapacitySections() {
  const [state, setState] = useState<SectionsState>({
    status: 'loading',
    sections: [],
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    fetchRaiseCapacitySections()
      .then((sections) => {
        if (!cancelled) setState({ status: 'ready', sections })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', sections: [] })
      })

    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading', sections: [] })
    setAttempt((count) => count + 1)
  }, [])

  return { ...state, retry }
}

export default useRaiseCapacitySections

import { useEffect, useState } from 'react'
import { courseNames } from '../services/raiseCapacityReview'

// Names of the given courses, for labelling course IDs. Missing names simply
// leave the ID on its own.
function useCourseNames(ids: string[]) {
  const key = [...new Set(ids)].sort().join(',')
  const [loaded, setLoaded] = useState<{ key: string; names: Map<string, string> } | null>(null)

  useEffect(() => {
    if (!key) return
    let cancelled = false
    courseNames(key.split(','))
      .then((names) => {
        if (!cancelled) setLoaded({ key, names })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, names: new Map() })
      })
    return () => {
      cancelled = true
    }
  }, [key])

  return loaded && loaded.key === key ? loaded.names : new Map<string, string>()
}

export default useCourseNames

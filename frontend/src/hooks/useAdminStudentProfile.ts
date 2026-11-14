import { useCallback, useEffect, useState } from 'react'
import { fetchAdminStudentProfile, type AdminStudentProfile } from '../services/adminStudentProfile'

type Status = 'loading' | 'ready' | 'not-found' | 'error'

interface Loaded {
  forKey: string
  status: Exclude<Status, 'loading'>
  profile: AdminStudentProfile | null
}

// One student's profile for staff, with a retry after a loading failure.
// "not-found" means no student has this ID; a failure is never shown as one.
function useAdminStudentProfile(studentId: string | undefined) {
  const [attempt, setAttempt] = useState(0)
  const key = studentId ? `${studentId}#${attempt}` : ''
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    if (!studentId) return
    let cancelled = false
    fetchAdminStudentProfile(studentId)
      .then((profile) => {
        if (!cancelled) setLoaded({ forKey: key, status: profile ? 'ready' : 'not-found', profile })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ forKey: key, status: 'error', profile: null })
      })
    return () => {
      cancelled = true
    }
  }, [studentId, key])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  const current = loaded && loaded.forKey === key ? loaded : null
  return {
    status: (studentId ? (current?.status ?? 'loading') : 'not-found') as Status,
    profile: current?.profile ?? null,
    retry,
  }
}

export default useAdminStudentProfile

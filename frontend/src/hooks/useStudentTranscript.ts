import { useCallback, useEffect, useState } from 'react'
import { loadTranscript } from '../services/adminStudentProfile'
import type { TranscriptEntry } from '../utils/studentProfile'

type Status = 'loading' | 'ready' | 'error'

interface Loaded {
  forKey: string
  status: Exclude<Status, 'loading'>
  entries: TranscriptEntry[]
}

// The signed-in student's own transcript for My Profile, loaded and retried
// on its own so a failure never hides the rest of the profile.
//
// `studentId` must be the Student_ID of the student's own record, as read by
// Auth UID (services/studentProfile.ts) — never a URL parameter or user
// input. The database policy "Students can view own academic records" is
// what limits the rows to that student; the ID only narrows the query.
function useStudentTranscript(studentId: string | null) {
  const [attempt, setAttempt] = useState(0)
  const key = studentId ? `${studentId}#${attempt}` : ''
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    if (!studentId) return
    let cancelled = false
    loadTranscript(studentId)
      .then((entries) => {
        if (!cancelled) setLoaded({ forKey: key, status: 'ready', entries })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ forKey: key, status: 'error', entries: [] })
      })
    return () => {
      cancelled = true
    }
  }, [studentId, key])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  const current = loaded && loaded.forKey === key ? loaded : null
  return {
    status: (studentId ? (current?.status ?? 'loading') : 'error') as Status,
    entries: current?.entries ?? [],
    retry,
  }
}

export default useStudentTranscript

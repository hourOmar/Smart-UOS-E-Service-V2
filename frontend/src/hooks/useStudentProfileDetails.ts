import { useCallback, useEffect, useState } from 'react'
import {
  fetchStudentProfileDetails,
  type StudentProfileDetails,
} from '../services/studentProfile'

type Status = 'loading' | 'ready' | 'not-found' | 'error'

interface ProfileDetailsState {
  status: Status
  profile: StudentProfileDetails | null
}

// Loads the signed-in student's full record for My Profile, with a retry
// after an error. "not-found" means the account has no linked Student row.
function useStudentProfileDetails() {
  const [state, setState] = useState<ProfileDetailsState>({
    status: 'loading',
    profile: null,
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    fetchStudentProfileDetails()
      .then((profile) => {
        if (!cancelled) setState(profile ? { status: 'ready', profile } : { status: 'not-found', profile: null })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', profile: null })
      })

    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading', profile: null })
    setAttempt((count) => count + 1)
  }, [])

  return { ...state, retry }
}

export default useStudentProfileDetails

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../services/supabase'

type Status = 'loading' | 'ready' | 'error'

export interface StudentProfileState {
  status: Status
  fullName: string | null
  firstName: string | null
  studentId: string | null
  email: string | null
}

const emptyProfile = {
  fullName: null,
  firstName: null,
  studentId: null,
  email: null,
}

const firstNameOf = (fullName: string | null | undefined) => {
  const first = fullName?.trim().split(/\s+/)[0]
  return first ? first : null
}

// Looks up the signed-in student's record by Auth UID (the same match the
// login, ProtectedRoute and the database policies use).
function useStudentProfile() {
  const [state, setState] = useState<StudentProfileState>({
    status: 'loading',
    ...emptyProfile,
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        if (!cancelled) setState({ status: 'error', ...emptyProfile })
        return
      }

      // The student is identified by the signed-in user's Auth UID (as in the
      // database policies), never by email: Auth stores the email in lowercase.
      const { data: student, error: studentError } = await supabase
        .from('Student')
        .select('Student_ID, Student_Name')
        .eq('Auth_User_ID', user.id)
        .maybeSingle()

      if (cancelled) return

      // The signed-in account's own address, for display only.
      const email = user.email ?? null
      if (studentError || !student) {
        setState({ status: 'error', ...emptyProfile, email })
        return
      }

      const fullName = student.Student_Name?.trim() || null

      setState({
        status: 'ready',
        fullName,
        firstName: firstNameOf(fullName),
        studentId:
          student.Student_ID != null ? String(student.Student_ID) : null,
        email,
      })
    }

    load()

    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading', ...emptyProfile })
    setAttempt((count) => count + 1)
  }, [])

  return { ...state, retry }
}

export default useStudentProfile

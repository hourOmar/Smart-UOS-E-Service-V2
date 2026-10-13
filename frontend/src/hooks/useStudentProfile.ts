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

// Looks up the signed-in student's record by email (the same match the
// login and ProtectedRoute use).
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

      if (userError || !user?.email) {
        if (!cancelled) setState({ status: 'error', ...emptyProfile })
        return
      }

      const { data: student, error: studentError } = await supabase
        .from('Student')
        .select('Student_ID, Student_Name')
        .eq('Student_Email', user.email)
        .maybeSingle()

      if (cancelled) return

      // The email is the signed-in account's own address (the one
      // matched to Student_Email above), so it needs no extra query.
      if (studentError || !student) {
        setState({ status: 'error', ...emptyProfile, email: user.email })
        return
      }

      const fullName = student.Student_Name?.trim() || null

      setState({
        status: 'ready',
        fullName,
        firstName: firstNameOf(fullName),
        studentId:
          student.Student_ID != null ? String(student.Student_ID) : null,
        email: user.email,
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

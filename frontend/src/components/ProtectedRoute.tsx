import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { supabase } from '../services/supabase'

type Role = 'student' | 'admin'

interface ProtectedRouteProps {
  children: ReactNode
  requiredRole: Role
}

function ProtectedRoute({
  children,
  requiredRole,
}: ProtectedRouteProps) {
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<Role | null>(null)

  useEffect(() => {
    const checkAccess = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setLoading(false)
        return
      }

      const { data: staff } = await supabase
        .from('Authorized_Staff')
        .select('Staff_ID')
        .eq('Auth_User_ID', user.id)
        .maybeSingle()

      if (staff) {
        setRole('admin')
        setLoading(false)
        return
      }

      const { data: student } = await supabase
        .from('Student')
        .select('Student_ID')
        .eq('Student_Email', user.email)
        .maybeSingle()

      if (student) {
        setRole('student')
      }

      setLoading(false)
    }

    checkAccess()
  }, [])

  if (loading) {
    return <p>Loading...</p>
  }

  if (!role) {
    return <Navigate to="/" replace />
  }

  if (role !== requiredRole) {
    return (
      <Navigate
        to={role === 'admin' ? '/admin' : '/student'}
        replace
      />
    )
  }

  return children
}

export default ProtectedRoute
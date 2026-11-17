import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { supabase } from '../services/supabase'
import { resolveAccountRole, type RoleLookupClient } from '../utils/loginFlow'

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

      // Staff first, then student -- both by the signed-in user's Auth UID,
      // as on the login page (utils/loginFlow.ts) and in the database policies.
      // (The full Supabase client type is too deep to compare with
      // RoleLookupClient structurally; it provides exactly the calls listed.)
      const account = await resolveAccountRole(supabase as unknown as RoleLookupClient, user.id)

      if (account === 'staff') {
        setRole('admin')
      } else if (account === 'student') {
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
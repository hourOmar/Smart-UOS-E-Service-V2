import { useEffect, useState } from 'react'
import { fetchStaffIdentity } from '../services/adminRequests'
import type { AccountIdentity } from '../components/student/AccountMenu'

// The signed-in staff member's name and email (own Authorized_Staff row),
// shaped for the shared account menu.
function useStaffIdentity(): AccountIdentity {
  const [identity, setIdentity] = useState<AccountIdentity>({
    status: 'loading',
    fullName: null,
    email: null,
  })

  useEffect(() => {
    let cancelled = false
    fetchStaffIdentity()
      .then((staff) => {
        if (!cancelled) setIdentity({ status: 'ready', ...staff })
      })
      .catch(() => {
        if (!cancelled) setIdentity({ status: 'error', fullName: null, email: null })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return identity
}

export default useStaffIdentity

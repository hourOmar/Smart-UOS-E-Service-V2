import { useState } from 'react'
import { notAvailableMessage } from '../data/academicRequests'
import useStaffIdentity from '../hooks/useStaffIdentity'
import useRequestTypeCounts from '../hooks/useRequestTypeCounts'
import useToast from '../hooks/useToast'
import StudentLayout from '../components/student/StudentLayout'
import Toast from '../components/student/Toast'
import AdminSearch from '../components/admin/AdminSearch'
import AdminRequestTypes from '../components/admin/AdminRequestTypes'
import PendingRequests from '../components/admin/PendingRequests'
import { ADMIN_HOME_ITEM, ADMIN_HOME_PATH } from '../utils/adminPaths'
import '../components/requests/Requests.css'
import './AdminDashboard.css'

// Admin home, following the approved prototype: search hero, request-type
// totals and the Pending Requests table. All data is read live from the
// database with the signed-in staff member's access.
function AdminDashboard() {
  const identity = useStaffIdentity()
  const typeCounts = useRequestTypeCounts()
  const [pendingType, setPendingType] = useState<string | null>(null)
  const [pendingPage, setPendingPage] = useState(1)
  const toast = useToast()

  const handleTypeChange = (type: string | null) => {
    setPendingType(type)
    setPendingPage(1)
  }

  return (
    <StudentLayout profile={identity} homePath={ADMIN_HOME_PATH} menuItems={[ADMIN_HOME_ITEM]}>
      <AdminSearch />

      <div className="adm-main">
        <AdminRequestTypes
          status={typeCounts.status}
          counts={typeCounts.counts}
          onRetry={typeCounts.retry}
          onUnavailable={(service) => toast.show(notAvailableMessage(service.name))}
        />
      </div>

      <PendingRequests
        counts={typeCounts.counts}
        type={pendingType}
        page={pendingPage}
        onTypeChange={handleTypeChange}
        onPageChange={setPendingPage}
      />

      <Toast message={toast.message} onDismiss={toast.dismiss} />
    </StudentLayout>
  )
}

export default AdminDashboard

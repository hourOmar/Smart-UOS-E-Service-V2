import { Link, useLocation } from 'react-router-dom'
import { getAcademicRequest } from '../../data/academicRequests'
import type { AcademicRequestId } from '../../data/academicRequests'
import {
  ADMIN_HOME_PATH,
  adminTypePath,
  allRequestsReturnPath,
  fromStudentProfile,
  studentProfilePath,
} from '../../utils/adminPaths'
import { BreadcrumbBackIcon, BreadcrumbSeparator } from '../student/ServiceBreadcrumb'
import '../student/ServiceBreadcrumb.css'

function DashboardLink() {
  return (
    <Link to={ADMIN_HOME_PATH} className="service-breadcrumb__back">
      <BreadcrumbBackIcon />
      Admin Dashboard
    </Link>
  )
}

interface ReviewBreadcrumbProps {
  typeId: AcademicRequestId
}

// Admin Dashboard › {Type} Requests › Request Review, on every staff review
// page, in the student breadcrumb's style. The type name comes from the catalog.
// Opened from a Student Profile's request history, the middle step leads back
// to that student instead: Admin Dashboard › Student {ID} › Request Review.
// Opened from All Requests: Admin Dashboard › All Requests › Request Review,
// back to the list with its search, filters, sort and page.
function ReviewBreadcrumb({ typeId }: ReviewBreadcrumbProps) {
  const location = useLocation()
  const name = getAcademicRequest(typeId)?.name ?? ''
  const studentId = fromStudentProfile(location.state)
  const allRequests = allRequestsReturnPath(location.state)

  return (
    <nav aria-label="Breadcrumb" className="service-breadcrumb">
      <DashboardLink />
      <BreadcrumbSeparator />
      {studentId ? (
        <Link to={studentProfilePath(studentId)} className="service-breadcrumb__link">
          Student <span className="adm-mono">{studentId}</span>
        </Link>
      ) : allRequests ? (
        <Link to={allRequests} className="service-breadcrumb__link">
          All Requests
        </Link>
      ) : (
        <Link to={adminTypePath(typeId)} className="service-breadcrumb__link">
          {name} Requests
        </Link>
      )}
      <BreadcrumbSeparator />
      <span aria-current="page" className="service-breadcrumb__current">
        Request Review
      </span>
    </nav>
  )
}

// Admin Dashboard › All Requests, on the All Requests page.
export function AllRequestsBreadcrumb() {
  return (
    <nav aria-label="Breadcrumb" className="service-breadcrumb">
      <DashboardLink />
      <BreadcrumbSeparator />
      <span aria-current="page" className="service-breadcrumb__current">
        All Requests
      </span>
    </nav>
  )
}

// Admin Dashboard › Student Profile, on the admin Student Profile page.
export function StudentProfileBreadcrumb() {
  return (
    <nav aria-label="Breadcrumb" className="service-breadcrumb">
      <DashboardLink />
      <BreadcrumbSeparator />
      <span aria-current="page" className="service-breadcrumb__current">
        Student Profile
      </span>
    </nav>
  )
}

export default ReviewBreadcrumb

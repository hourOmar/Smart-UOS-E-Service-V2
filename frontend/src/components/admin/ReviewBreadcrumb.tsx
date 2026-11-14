import { Link } from 'react-router-dom'
import { getAcademicRequest } from '../../data/academicRequests'
import type { AcademicRequestId } from '../../data/academicRequests'
import { ADMIN_HOME_PATH, adminTypePath } from '../../utils/adminPaths'
import { BreadcrumbBackIcon, BreadcrumbSeparator } from '../student/ServiceBreadcrumb'
import '../student/ServiceBreadcrumb.css'

interface ReviewBreadcrumbProps {
  typeId: AcademicRequestId
}

// Admin Dashboard › {Type} Requests › Request Review, on every staff review
// page, in the student breadcrumb's style. The type name comes from the catalog.
function ReviewBreadcrumb({ typeId }: ReviewBreadcrumbProps) {
  const name = getAcademicRequest(typeId)?.name ?? ''

  return (
    <nav aria-label="Breadcrumb" className="service-breadcrumb">
      <Link to={ADMIN_HOME_PATH} className="service-breadcrumb__back">
        <BreadcrumbBackIcon />
        Admin Dashboard
      </Link>
      <BreadcrumbSeparator />
      <Link to={adminTypePath(typeId)} className="service-breadcrumb__link">
        {name} Requests
      </Link>
      <BreadcrumbSeparator />
      <span aria-current="page" className="service-breadcrumb__current">
        Request Review
      </span>
    </nav>
  )
}

export default ReviewBreadcrumb

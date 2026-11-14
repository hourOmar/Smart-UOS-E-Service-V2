import { Link } from 'react-router-dom'
import { CATALOG_ANCHOR_ID, getAcademicRequest, serviceDetailsPath } from '../../data/academicRequests'
import type { AcademicRequestId } from '../../data/academicRequests'
import './ServiceBreadcrumb.css'

// The circled back arrow before a breadcrumb's first (home) link.
export function BreadcrumbBackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M13.5 8.5 10 12l3.5 3.5" />
    </svg>
  )
}

// Link to the student dashboard, landing on its Academic Requests section.
export function CatalogLink() {
  return (
    <Link
      to="/student"
      state={{ scrollTo: CATALOG_ANCHOR_ID }}
      className="service-breadcrumb__back"
    >
      <BreadcrumbBackIcon />
      Academic Requests
    </Link>
  )
}

export function BreadcrumbSeparator() {
  return (
    <span aria-hidden="true" className="service-breadcrumb__separator">
      ›
    </span>
  )
}

interface ServiceBreadcrumbProps {
  serviceId: AcademicRequestId
  /** A page below the service, e.g. "New Request" on its form. Without it,
   *  the service's details page is the current page. */
  current?: string
}

// Academic Requests › {Service} [› {current}], shared by the service-details
// pages and the request forms. The service name comes from the catalog.
function ServiceBreadcrumb({ serviceId, current }: ServiceBreadcrumbProps) {
  const name = getAcademicRequest(serviceId)?.name ?? ''

  return (
    <nav aria-label="Breadcrumb" className="service-breadcrumb">
      <CatalogLink />
      <BreadcrumbSeparator />
      {current ? (
        <>
          <Link to={serviceDetailsPath(serviceId)} className="service-breadcrumb__link">
            {name}
          </Link>
          <BreadcrumbSeparator />
          <span aria-current="page" className="service-breadcrumb__current">
            {current}
          </span>
        </>
      ) : (
        <span aria-current="page" className="service-breadcrumb__current">
          {name}
        </span>
      )}
    </nav>
  )
}

export default ServiceBreadcrumb

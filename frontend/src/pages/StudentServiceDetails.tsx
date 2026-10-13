import { Link, useParams } from 'react-router-dom'
import {
  CATALOG_ANCHOR_ID,
  getAcademicRequest,
} from '../data/academicRequests'
import useStudentProfile from '../hooks/useStudentProfile'
import StudentLayout from '../components/student/StudentLayout'
import RequestIcon from '../components/student/RequestIcon'
import ServiceSummaryStrip from '../components/student/ServiceSummaryStrip'
import ServiceAccordion from '../components/student/ServiceAccordion'
import type { AccordionSection } from '../components/student/ServiceAccordion'
import BeforeYouSubmit from '../components/student/BeforeYouSubmit'
import './StudentServiceDetails.css'

// Back link to the dashboard's Academic Requests section.
function CatalogLink() {
  return (
    <Link
      to="/student"
      state={{ scrollTo: CATALOG_ANCHOR_ID }}
      className="service-page__back"
    >
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
      Academic Requests
    </Link>
  )
}

// One template for every service-details page; content comes from the
// fixed service definitions in academicRequests.ts.
function StudentServiceDetails() {
  const { serviceId } = useParams()
  const profile = useStudentProfile()
  const request = getAcademicRequest(serviceId)

  if (!request) {
    return (
      <StudentLayout profile={profile} solidHeader>
        <div className="service-page">
          <CatalogLink />
          <div className="service-page__missing" role="status">
            <h1 className="service-page__missing-title">Service not found</h1>
            <p>This academic request service does not exist.</p>
          </div>
        </div>
      </StudentLayout>
    )
  }

  const { details } = request

  // Every service shows the same four sections; one whose content has not
  // been supplied yet keeps its heading and has nothing to expand.
  const sections: AccordionSection[] = [
    { key: 'description', title: 'Description', intro: details.description, items: [] },
    { key: 'steps', title: 'Submission Steps', items: details.steps, numbered: true },
    { key: 'documents', title: 'Required Documents', items: details.requiredDocuments },
    { key: 'notes', title: 'Important Notes', items: details.notes },
  ]

  return (
    <StudentLayout profile={profile} solidHeader>
      <div className="service-page">
        <nav aria-label="Breadcrumb" className="service-page__breadcrumb">
          <CatalogLink />
          <span aria-hidden="true" className="service-page__separator">
            /
          </span>
          <span aria-current="page" className="service-page__current">
            {request.name}
          </span>
        </nav>

        <div className="service-page__head">
          <div className="service-page__identity">
            <span className="service-page__icon">
              <RequestIcon id={request.id} />
            </span>
            <div className="service-page__heading">
              <h1 className="service-page__title">{request.name}</h1>
              <p className="service-page__description">{request.description}</p>
            </div>
          </div>
        </div>

        <ServiceSummaryStrip details={details} />

        <div className="service-page__body">
          <ServiceAccordion
            key={request.id}
            sections={sections}
            initiallyOpen={['description']}
          />
          <BeforeYouSubmit request={request} />
        </div>
      </div>
    </StudentLayout>
  )
}

export default StudentServiceDetails

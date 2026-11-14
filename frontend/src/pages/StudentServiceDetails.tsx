import { useParams } from 'react-router-dom'
import { getAcademicRequest } from '../data/academicRequests'
import useStudentProfile from '../hooks/useStudentProfile'
import StudentLayout from '../components/student/StudentLayout'
import ServiceBreadcrumb, { CatalogLink } from '../components/student/ServiceBreadcrumb'
import RequestIcon from '../components/student/RequestIcon'
import ServiceSummaryStrip from '../components/student/ServiceSummaryStrip'
import ServiceAccordion from '../components/student/ServiceAccordion'
import type { AccordionSection } from '../components/student/ServiceAccordion'
import BeforeYouSubmit from '../components/student/BeforeYouSubmit'
import './StudentServiceDetails.css'

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
        <ServiceBreadcrumb serviceId={request.id} />

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

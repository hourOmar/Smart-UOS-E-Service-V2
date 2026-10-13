import type { AcademicRequestType } from '../../data/academicRequests'
import StartRequestButton from './StartRequestButton'

interface BeforeYouSubmitProps {
  request: AcademicRequestType
}

// Side panel: the service's preparation checklist and the page's only
// Start request action.
function BeforeYouSubmit({ request }: BeforeYouSubmitProps) {
  return (
    <aside className="before-submit" aria-labelledby="before-submit-title">
      <h2 id="before-submit-title" className="before-submit__title">
        <span className="before-submit__accent">Before</span> you submit
      </h2>
      {request.details.checklist.length > 0 && (
        <ul className="before-submit__list">
          {request.details.checklist.map((item) => (
            <li key={item} className="before-submit__item">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
                <path d="m8 12.5 2.8 2.8L16.5 9.5" />
              </svg>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
      <StartRequestButton
        request={request}
        className="service-start service-start--block"
        withArrow
        linkState={{ from: 'details' }}
      />
    </aside>
  )
}

export default BeforeYouSubmit

import { Link } from 'react-router-dom'
import {
  FUTURE_SERVICE_DESCRIPTION,
  serviceDetailsPath,
  type AcademicRequestType,
  type FutureService,
} from '../../data/academicRequests'
import RequestIcon from './RequestIcon'
import StartRequestButton from './StartRequestButton'

interface RequestCardProps {
  request: AcademicRequestType
  /** Start request of a service whose form does not exist yet. */
  onUnavailable: (request: AcademicRequestType) => void
}

// One service card with the approved split footer: View details opens the
// service's details page; Start request opens its form once it exists.
function RequestCard({ request, onUnavailable }: RequestCardProps) {
  return (
    <article className="student-service">
      <div className="student-service__body">
        <span className="student-service__icon-box">
          <RequestIcon id={request.id} />
        </span>
        <div className="student-service__text">
          <h3 className="student-service__name">{request.name}</h3>
          <p className="student-service__description">{request.description}</p>
        </div>
      </div>

      <div className="student-service__footer">
        <Link
          to={serviceDetailsPath(request.id)}
          className="student-service__details"
        >
          View details
          <span className="student-visually-hidden"> for {request.name}</span>
        </Link>
        <StartRequestButton
          request={request}
          className="student-service__start"
          onUnavailable={() => onUnavailable(request)}
        />
      </div>
    </article>
  )
}

interface FutureServiceCardProps {
  service: FutureService
  /** Both buttons only explain that the service is not offered yet. */
  onOpen: (service: FutureService) => void
}

// A service planned for a future release. It looks like the other cards
// (prototype v3); its buttons show a message and nothing else.
export function FutureServiceCard({ service, onOpen }: FutureServiceCardProps) {
  const open = () => onOpen(service)

  return (
    <article className="student-service">
      <div className="student-service__body">
        <span className="student-service__icon-box">
          <RequestIcon path={service.icon} />
        </span>
        <div className="student-service__text">
          <h3 className="student-service__name">{service.name}</h3>
          <p className="student-service__description">{FUTURE_SERVICE_DESCRIPTION}</p>
        </div>
      </div>

      <div className="student-service__footer">
        <button
          type="button"
          className="student-service__details"
          aria-disabled="true"
          onClick={open}
        >
          View details
          <span className="student-visually-hidden"> for {service.name}, not yet available</span>
        </button>
        <button
          type="button"
          className="student-service__start"
          aria-disabled="true"
          onClick={open}
        >
          Start request
          <span className="student-visually-hidden"> for {service.name}, not yet available</span>
        </button>
      </div>
    </article>
  )
}

export default RequestCard

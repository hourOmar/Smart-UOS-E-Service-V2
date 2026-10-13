import { Link } from 'react-router-dom'
import {
  serviceDetailsPath,
  type AcademicRequestType,
} from '../../data/academicRequests'
import RequestIcon from './RequestIcon'
import StartRequestButton from './StartRequestButton'

interface RequestCardProps {
  request: AcademicRequestType
}

// One service card with the approved split footer: View details opens the
// service's details page; Start request opens its form once it exists.
function RequestCard({ request }: RequestCardProps) {
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
        />
      </div>
    </article>
  )
}

export default RequestCard

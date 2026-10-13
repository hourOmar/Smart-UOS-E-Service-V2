import { Link } from 'react-router-dom'
import type { AcademicRequestType } from '../../data/academicRequests'

interface StartRequestButtonProps {
  request: AcademicRequestType
  className: string
  /** The details page shows a trailing arrow, as in the prototype. */
  withArrow?: boolean
  /** Router state for the form, e.g. so its Back link returns to details. */
  linkState?: unknown
}

// "Start request" in its approved position. It links to the service's real
// form once one exists (startPath); until then it is a disabled button with
// no action, and screen readers are told it is not yet available.
function StartRequestButton({ request, className, withArrow = false, linkState }: StartRequestButtonProps) {
  const arrow = withArrow ? <span aria-hidden="true">→</span> : null

  if (request.startPath) {
    return (
      <Link to={request.startPath} state={linkState} className={className}>
        Start request
        <span className="student-visually-hidden"> for {request.name}</span>
        {arrow}
      </Link>
    )
  }

  return (
    <button type="button" className={className} disabled>
      Start request
      <span className="student-visually-hidden">
        {' '}for {request.name}, not yet available
      </span>
      {arrow}
    </button>
  )
}

export default StartRequestButton

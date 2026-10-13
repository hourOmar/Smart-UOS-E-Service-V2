import { Link } from 'react-router-dom'
import { raiseCapacityReviewPath, type ReviewOrigin } from '../../utils/adminPaths'

interface ReviewActionProps {
  requestId: string
  requestType: string
  /** Where the review page's back link returns to. */
  origin: ReviewOrigin
}

// "Review" in the admin lists: a link for Raise Capacity requests, which have a
// review page; a disabled button for every other type until theirs exists.
function ReviewAction({ requestId, requestType, origin }: ReviewActionProps) {
  if (requestType === 'Raise Capacity') {
    return (
      <Link to={raiseCapacityReviewPath(requestId)} state={{ from: origin }} className="adm-review">
        Review
        <span className="student-visually-hidden"> request {requestId}</span>
      </Link>
    )
  }
  return (
    <button type="button" className="adm-review" disabled>
      Review
      <span className="student-visually-hidden"> request {requestId}, not yet available</span>
    </button>
  )
}

export default ReviewAction

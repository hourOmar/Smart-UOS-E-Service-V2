import { Link } from 'react-router-dom'
import { programChangeReviewPath, raiseCapacityReviewPath, type ReviewOrigin } from '../../utils/adminPaths'

// Request types with a staff review page.
const REVIEW_PATHS: Record<string, (requestId: string) => string> = {
  'Raise Capacity': raiseCapacityReviewPath,
  'Program Change': programChangeReviewPath,
}

interface ReviewActionProps {
  requestId: string
  requestType: string
  /** Where the review page's back link returns to. */
  origin: ReviewOrigin
}

// "Review" in the admin lists: a link for the types that have a review page
// (Raise Capacity, Program Change); a disabled button for every other type
// until theirs exists.
function ReviewAction({ requestId, requestType, origin }: ReviewActionProps) {
  const reviewPath = REVIEW_PATHS[requestType]
  if (reviewPath) {
    return (
      <Link to={reviewPath(requestId)} state={{ from: origin }} className="adm-review">
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

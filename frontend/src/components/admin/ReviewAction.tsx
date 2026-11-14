import { Link } from 'react-router-dom'
import { reviewPathFor, type ReviewOrigin } from '../../utils/adminPaths'

interface ReviewActionProps {
  requestId: string
  requestType: string
  /** Where the review page's back link returns to. */
  origin: ReviewOrigin
}

// "Review" in the admin lists: a link for the types that have a review page
// (Raise Capacity, Program Change, Incomplete Exam, Course Substitution); a disabled button for every other type
// until theirs exists.
function ReviewAction({ requestId, requestType, origin }: ReviewActionProps) {
  const reviewPath = reviewPathFor(requestType, requestId)
  if (reviewPath) {
    return (
      <Link to={reviewPath} state={{ from: origin }} className="adm-review">
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

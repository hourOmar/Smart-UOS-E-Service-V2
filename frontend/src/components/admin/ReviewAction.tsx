import { Link } from 'react-router-dom'
import { reviewPathFor, type ReviewOrigin } from '../../utils/adminPaths'

interface ReviewActionProps {
  requestId: string
  requestType: string
  /** Where the review page's back link returns to. */
  origin: ReviewOrigin
  /** All Requests only: the list's query string, restored on the way back. */
  returnSearch?: string
  /** The link text; "View" for decided requests on All Requests. */
  label?: 'Review' | 'View'
}

// "Review" in the admin lists: a link to the type's review page; a disabled
// button for a type without one.
function ReviewAction({ requestId, requestType, origin, returnSearch = '', label = 'Review' }: ReviewActionProps) {
  const reviewPath = reviewPathFor(requestType, requestId)
  if (reviewPath) {
    const state = origin === 'all-requests' ? { from: origin, search: returnSearch } : { from: origin }
    return (
      <Link to={reviewPath} state={state} className="adm-review">
        {label}
        <span className="student-visually-hidden"> request {requestId}</span>
      </Link>
    )
  }
  return (
    <button type="button" className="adm-review" disabled>
      {label}
      <span className="student-visually-hidden"> request {requestId}, not yet available</span>
    </button>
  )
}

export default ReviewAction

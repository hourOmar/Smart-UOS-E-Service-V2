import { Link } from 'react-router-dom'
import useStudentRequests from '../../hooks/useStudentRequests'
import useRequestTargets from '../../hooks/useRequestTargets'
import { MY_REQUESTS_PATH, RECENT_REQUESTS_ANCHOR_ID } from '../../utils/requestPaths'
import RequestList from '../requests/RequestList'

// The final prototype (v3) lists the six newest requests.
const RECENT_LIMIT = 6

// Dashboard section below Academic Requests: the student's latest
// requests (newest submission first), with a link to the full list.
function RecentRequests() {
  const { status, requests, retry } = useStudentRequests(RECENT_LIMIT)
  const targets = useRequestTargets(status === 'ready' ? requests : null)

  return (
    <section
      id={RECENT_REQUESTS_ANCHOR_ID}
      className="student-recent"
      aria-labelledby="student-recent-title"
    >
      <div className="student-recent__inner">
        <div className="student-recent__head">
          <div className="student-recent__heading">
            <h2 id="student-recent-title" className="student-recent__title">
              Recent Requests
            </h2>
            <p className="student-recent__intro">
              Your latest submissions and their current status.
            </p>
          </div>
          <Link to={MY_REQUESTS_PATH} className="student-recent__all">
            View all requests
            <span aria-hidden="true">→</span>
          </Link>
        </div>

        <RequestList
          status={status}
          requests={requests}
          onRetry={retry}
          origin="dashboard"
          idHeading="Request Reference"
          targets={targets}
          showTarget
        />
      </div>
    </section>
  )
}

export default RecentRequests

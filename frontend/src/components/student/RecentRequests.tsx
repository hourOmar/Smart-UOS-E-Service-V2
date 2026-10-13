import { Link } from 'react-router-dom'
import useStudentRequests from '../../hooks/useStudentRequests'
import { MY_REQUESTS_PATH, RECENT_REQUESTS_ANCHOR_ID } from '../../utils/requestPaths'
import RequestList from '../requests/RequestList'

const RECENT_LIMIT = 3

// Dashboard section below Academic Requests: the student's latest
// requests, with a link to the full list.
function RecentRequests() {
  const { status, requests, retry } = useStudentRequests(RECENT_LIMIT)

  return (
    <section
      id={RECENT_REQUESTS_ANCHOR_ID}
      className="student-recent"
      aria-labelledby="student-recent-title"
    >
      <div className="student-recent__inner">
        <div className="student-recent__head">
          <h2 id="student-recent-title" className="student-recent__title">
            Recent Requests
          </h2>
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
        />
      </div>
    </section>
  )
}

export default RecentRequests

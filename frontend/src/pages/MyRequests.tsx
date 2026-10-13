import { Link } from 'react-router-dom'
import useStudentProfile from '../hooks/useStudentProfile'
import useStudentRequests from '../hooks/useStudentRequests'
import StudentLayout from '../components/student/StudentLayout'
import RequestList from '../components/requests/RequestList'
import '../components/requests/Requests.css'

// All of the signed-in student's requests, across every request type,
// newest first. Opened from the account menu and from Recent Requests.
function MyRequests() {
  const profile = useStudentProfile()
  const { status, requests, retry } = useStudentRequests()

  return (
    <StudentLayout profile={profile} solidHeader>
      <div className="req-page">
        <Link to="/student" className="req-page__back">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M13.5 8.5 10 12l3.5 3.5" />
          </svg>
          Back to dashboard
        </Link>

        <div className="req-page__intro">
          <h1 className="req-page__title">My Requests</h1>
          <p className="req-page__lede">
            All the academic requests you have submitted, newest first.
          </p>
        </div>

        <RequestList
          status={status}
          requests={requests}
          onRetry={retry}
          origin="my-requests"
        />
      </div>
    </StudentLayout>
  )
}

export default MyRequests

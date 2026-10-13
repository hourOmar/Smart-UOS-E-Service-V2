import { Link } from 'react-router-dom'
import useStudentProfile from '../hooks/useStudentProfile'
import useStudentProfileDetails from '../hooks/useStudentProfileDetails'
import type { StudentProfileDetails } from '../services/studentProfile'
import StudentLayout from '../components/student/StudentLayout'
import '../components/requests/Requests.css'
import './MyProfile.css'

interface Field {
  label: string
  value: string | null
}

function ProfilePanel({ id, title, fields }: { id: string; title: string; fields: Field[] }) {
  return (
    <section className="req-panel" aria-labelledby={id}>
      <h2 id={id} className="req-panel__title">
        {title}
      </h2>
      <div className="req-panel__body">
        <dl className="req-fields">
          {fields.map((field) => (
            <div key={field.label} className="req-fields__item">
              <dt>{field.label}</dt>
              {field.value ? (
                <dd>{field.value}</dd>
              ) : (
                <dd className="profile-missing">Not recorded</dd>
              )}
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

function ProfileBody({ profile }: { profile: StudentProfileDetails }) {
  return (
    <div className="profile-panels">
      <ProfilePanel
        id="profile-personal-title"
        title="Personal information"
        fields={[
          { label: 'Name', value: profile.name },
          { label: 'Student ID', value: profile.studentId },
          { label: 'Email', value: profile.email },
        ]}
      />
      <ProfilePanel
        id="profile-academic-title"
        title="Academic information"
        fields={[
          { label: 'Program', value: profile.program },
          { label: 'College', value: profile.college },
          { label: 'CGPA', value: profile.cgpa },
          { label: 'Completed credit hours', value: profile.completedHours },
          { label: 'Expected graduation term', value: profile.expectedGraduationTerm },
        ]}
      />
    </div>
  )
}

// The signed-in student's own record, read-only. Opened from the account
// menu. Everything comes from the database through the student's session.
function MyProfile() {
  const identity = useStudentProfile()
  const { status, profile, retry } = useStudentProfileDetails()

  return (
    <StudentLayout profile={identity} solidHeader>
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
          <h1 className="req-page__title">My Profile</h1>
          <p className="req-page__lede">Your student details as recorded by the university.</p>
        </div>

        {status === 'loading' && (
          <div className="req-state" role="status">
            <p className="req-state__body">Loading your profile…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="req-state" role="alert">
            <h2 className="req-state__title">We couldn’t load your profile.</h2>
            <p className="req-state__body">Check your connection and try again.</p>
            <button type="button" className="req-button" onClick={retry}>
              Try again
            </button>
          </div>
        )}

        {status === 'not-found' && (
          <div className="req-state" role="alert">
            <h2 className="req-state__title">No student record is linked to this account.</h2>
            <p className="req-state__body">
              If you think this is a mistake, try again or contact the university.
            </p>
            <button type="button" className="req-button" onClick={retry}>
              Try again
            </button>
          </div>
        )}

        {status === 'ready' && profile && <ProfileBody profile={profile} />}
      </div>
    </StudentLayout>
  )
}

export default MyProfile

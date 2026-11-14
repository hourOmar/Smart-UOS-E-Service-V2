import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import useStudentProfile from '../hooks/useStudentProfile'
import useStudentProfileDetails from '../hooks/useStudentProfileDetails'
import type { StudentProfileDetails } from '../services/studentProfile'
import StudentLayout from '../components/student/StudentLayout'
import '../components/requests/Requests.css'
import './MyProfile.css'

const NOT_RECORDED = 'Not recorded'

// Icon shapes from Lucide (lucide.dev, ISC licence), drawn inline like the
// app's other icons so no icon package is needed.
const ICONS = {
  // trending-up
  cgpa: (
    <>
      <path d="M22 7 13.5 15.5 8.5 10.5 2 17" />
      <path d="M16 7h6v6" />
    </>
  ),
  // book-open
  hours: (
    <>
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </>
  ),
  // graduation-cap
  graduation: (
    <>
      <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" />
      <path d="M22 10v6" />
      <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />
    </>
  ),
  // user
  personal: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  // building-2
  academic: (
    <>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4" />
      <path d="M10 10h4" />
      <path d="M10 14h4" />
      <path d="M10 18h4" />
    </>
  ),
}

function ProfileIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}

/** "Mariam Hassan Ali" → "MA": the first letters of the first and last
 *  names; null when no name is recorded. */
function initialsOf(name: string | null): string | null {
  const words = (name ?? '').split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  const first = words[0][0]
  const last = words.length > 1 ? words[words.length - 1][0] : ''
  return (first + last).toLocaleUpperCase()
}

function ProfileHeader({ profile }: { profile: StudentProfileDetails }) {
  const initials = initialsOf(profile.name)

  return (
    <section className="profile-hero" aria-labelledby="profile-name">
      <span className="profile-hero__avatar" aria-hidden="true">
        {initials ?? <ProfileIcon name="personal" />}
      </span>
      <div className="profile-hero__text">
        <h2 id="profile-name" className="profile-hero__name">
          {profile.name ?? 'Name not recorded'}
        </h2>
        <p className="profile-hero__meta">
          <span>
            <span className="profile-hero__meta-label">Student ID </span>
            {profile.studentId ?? NOT_RECORDED}
          </span>
          {profile.program && (
            <>
              <span className="profile-hero__dot" aria-hidden="true" />
              <span>{profile.program}</span>
            </>
          )}
        </p>
      </div>
    </section>
  )
}

function SummaryCard({ icon, label, value }: { icon: keyof typeof ICONS; label: string; value: string | null }) {
  return (
    <div className="profile-stat">
      <span className="profile-stat__icon">
        <ProfileIcon name={icon} />
      </span>
      <dl className="profile-stat__text">
        <dt className="profile-stat__label">{label}</dt>
        {value ? (
          <dd className="profile-stat__value">{value}</dd>
        ) : (
          <dd className="profile-stat__value profile-stat__value--missing">{NOT_RECORDED}</dd>
        )}
      </dl>
    </div>
  )
}

interface Field {
  label: string
  value: string | null
}

function InfoCard({ id, icon, title, fields }: { id: string; icon: keyof typeof ICONS; title: ReactNode; fields: Field[] }) {
  return (
    <section className="req-panel profile-info" aria-labelledby={id}>
      <h2 id={id} className="req-panel__title profile-info__title">
        <ProfileIcon name={icon} />
        {title}
      </h2>
      <dl className="profile-info__list">
        {fields.map((field) => (
          <div key={field.label} className="profile-info__row">
            <dt>{field.label}</dt>
            {field.value ? <dd>{field.value}</dd> : <dd className="profile-missing">{NOT_RECORDED}</dd>}
          </div>
        ))}
      </dl>
    </section>
  )
}

function ProfileBody({ profile }: { profile: StudentProfileDetails }) {
  return (
    <>
      <ProfileHeader profile={profile} />

      <section aria-label="Academic overview" className="profile-stats">
        <SummaryCard icon="cgpa" label="CGPA" value={profile.cgpa} />
        <SummaryCard icon="hours" label="Completed Credit Hours" value={profile.completedHours} />
        <SummaryCard icon="graduation" label="Expected Graduation Term" value={profile.expectedGraduationTerm} />
      </section>

      <div className="profile-panels">
        <InfoCard
          id="profile-personal-title"
          icon="personal"
          title="Personal Information"
          fields={[
            { label: 'Full name', value: profile.name },
            { label: 'Student ID', value: profile.studentId },
            { label: 'University email', value: profile.email },
          ]}
        />
        <InfoCard
          id="profile-academic-title"
          icon="academic"
          title="Academic Information"
          fields={[
            { label: 'Academic program', value: profile.program },
            { label: 'College', value: profile.college },
          ]}
        />
      </div>
    </>
  )
}

// The signed-in student's own record, read-only. Opened from the account
// menu. Everything comes from the database through the student's session.
function MyProfile() {
  const identity = useStudentProfile()
  const { status, profile, retry } = useStudentProfileDetails()

  return (
    <StudentLayout profile={identity} solidHeader>
      <div className="req-page profile-page">
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

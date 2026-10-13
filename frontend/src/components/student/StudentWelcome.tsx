import type { StudentProfileState } from '../../hooks/useStudentProfile'

interface StudentWelcomeProps {
  status: StudentProfileState['status']
  firstName: string | null
  onRetry: () => void
}

// Full-screen hero: the dashboard photograph under a dark overlay, with the
// greeting centred near the bottom.
function StudentWelcome({ status, firstName, onRetry }: StudentWelcomeProps) {
  return (
    <section className="student-hero" aria-labelledby="student-welcome-title">
      <div className="student-hero__content">
        <span className="student-hero__kicker">University of Sharjah</span>
        <h1
          id="student-welcome-title"
          className="student-hero__title"
          aria-busy={status === 'loading'}
        >
          Welcome back{firstName ? `, ${firstName}` : ''}.
        </h1>
        <p className="student-hero__lede">How can we help you today?</p>

        {status === 'error' && (
          <p className="student-hero__notice" role="status">
            We couldn’t load your student details.{' '}
            <button
              type="button"
              className="student-hero__retry"
              onClick={onRetry}
            >
              Try again
            </button>
          </p>
        )}
      </div>
    </section>
  )
}

export default StudentWelcome

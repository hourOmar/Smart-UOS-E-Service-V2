import type { StudentProfileState } from '../../hooks/useStudentProfile'
import HeroBackdrop from './HeroBackdrop'

interface StudentWelcomeProps {
  status: StudentProfileState['status']
  firstName: string | null
  onRetry: () => void
}

// Light hero of the final prototype (v3): the dome photograph on the right,
// the greeting on the left with the student's first name in green.
function StudentWelcome({ status, firstName, onRetry }: StudentWelcomeProps) {
  return (
    <section className="student-hero" aria-labelledby="student-welcome-title">
      <HeroBackdrop circuit />

      <div className="student-hero__content">
        <div className="student-hero__text">
          <span className="student-hero__kicker">University of Sharjah</span>
          <h1
            id="student-welcome-title"
            className="student-hero__title"
            aria-busy={status === 'loading'}
          >
            <span className="student-hero__greeting">
              Welcome back{firstName ? ',' : '.'}
            </span>
            {firstName && <span className="student-hero__name">{firstName}.</span>}
          </h1>
          <p className="student-hero__lede">How can we help you today?</p>
          <span className="student-hero__accent" aria-hidden="true">
            <span />
            <span />
          </span>

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
      </div>
    </section>
  )
}

export default StudentWelcome

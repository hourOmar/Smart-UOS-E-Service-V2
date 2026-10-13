import { Link } from 'react-router-dom'
import logoWhite from '../../assets/uos-logo-white.png'
import AccountMenu from './AccountMenu'
import type { AccountIdentity, AccountMenuItem } from './AccountMenu'

interface StudentTopNavProps {
  profile: AccountIdentity
  scrolled: boolean
  onSignOut: () => void
  /** Where the logo leads; the admin pages use /admin. */
  homePath?: string
  menuItems?: AccountMenuItem[]
}

// Transparent over the hero; turns solid black once the page scrolls.
function StudentTopNav({
  profile,
  scrolled,
  onSignOut,
  homePath = '/student',
  menuItems,
}: StudentTopNavProps) {
  return (
    <header className="student-header" data-scrolled={scrolled}>
      <div className="student-header__inner">
        <Link
          to={homePath}
          className="student-header__brand"
          aria-label="Smart UoS E-Service home"
        >
          <img
            className="student-header__logo"
            src={logoWhite}
            alt="University of Sharjah logo"
          />
          <span className="student-header__names">
            <span className="student-header__university">
              University of Sharjah
            </span>
            <span className="student-header__product">Smart UoS E-Service</span>
          </span>
        </Link>

        <AccountMenu profile={profile} onSignOut={onSignOut} menuItems={menuItems} />
      </div>
    </header>
  )
}

export default StudentTopNav

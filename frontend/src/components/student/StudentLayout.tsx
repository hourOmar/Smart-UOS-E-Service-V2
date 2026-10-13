import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import useScrolledPast from '../../hooks/useScrolledPast'
import StudentTopNav from './StudentTopNav'
import type { AccountIdentity, AccountMenuItem } from './AccountMenu'
import './StudentLayout.css'

// Matches the prototype: the header turns solid after 60px of scrolling.
const HEADER_SOLID_AFTER = 60

interface StudentLayoutProps {
  profile: AccountIdentity
  /** Inner pages keep the header solid black, as in the prototype. */
  solidHeader?: boolean
  /** The admin pages reuse this shell with their own home and menu items. */
  homePath?: string
  menuItems?: AccountMenuItem[]
  children: ReactNode
}

// Shared shell for every student page (and the admin home): scroll
// container, header and account menu, with the working sign-out.
function StudentLayout({
  profile,
  solidHeader = false,
  homePath,
  menuItems,
  children,
}: StudentLayoutProps) {
  const navigate = useNavigate()
  const pageRef = useRef<HTMLDivElement>(null)
  const scrolled = useScrolledPast(pageRef, HEADER_SOLID_AFTER)

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div className="student" ref={pageRef}>
      <StudentTopNav
        profile={profile}
        scrolled={solidHeader || scrolled}
        onSignOut={handleSignOut}
        homePath={homePath}
        menuItems={menuItems}
      />
      <main>{children}</main>
    </div>
  )
}

export default StudentLayout

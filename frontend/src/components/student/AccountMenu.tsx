import { useEffect, useId, useRef, useState } from 'react'
import type { FocusEvent } from 'react'
import { Link } from 'react-router-dom'
import type { StudentProfileState } from '../../hooks/useStudentProfile'
import { MY_PROFILE_PATH } from '../../utils/profilePaths'
import { MY_REQUESTS_PATH } from '../../utils/requestPaths'

/** What the menu shows about the signed-in person (student or staff). */
export type AccountIdentity = Pick<StudentProfileState, 'status' | 'fullName' | 'email'>

export interface AccountMenuItem {
  to: string
  label: string
  /** Defaults to the document icon. */
  icon?: 'profile' | 'document'
}

const STUDENT_MENU_ITEMS: AccountMenuItem[] = [
  { to: MY_PROFILE_PATH, label: 'My Profile', icon: 'profile' },
  { to: MY_REQUESTS_PATH, label: 'My Requests' },
]

// 24-unit icons in the menu's 1.7 stroke.
const ITEM_ICONS = {
  // An ID card: the student's record.
  profile: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="11" r="2.2" />
      <path d="M5.8 16.5c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14 10h4M14 13.5h3" />
    </>
  ),
  document: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M9 8.5h6M9 12h6M9 15.5h4" />
    </>
  ),
}

interface AccountMenuProps {
  profile: AccountIdentity
  onSignOut: () => void
  /** The menu's page links; students get My Profile and My Requests, staff Admin home. */
  menuItems?: AccountMenuItem[]
}

// A disclosure (button + panel), closed by Escape, an outside click,
// or focus leaving the menu.
function AccountMenu({ profile, onSignOut, menuItems = STUDENT_MENU_ITEMS }: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
      setOpen(false)
    }
  }

  return (
    <div className="student-account" ref={rootRef} onBlur={handleBlur}>
      <button
        ref={triggerRef}
        type="button"
        className="student-account__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="8.5" r="3.6" />
          <path d="M4.8 19.5c1.3-3.3 4-5 7.2-5s5.9 1.7 7.2 5" />
        </svg>
        <span className="student-visually-hidden">
          Account menu{profile.fullName ? ` for ${profile.fullName}` : ''}
        </span>
      </button>

      {open && (
        <div id={panelId} className="student-account__panel">
          <div className="student-account__identity">
            {profile.status === 'loading' && (
              <p className="student-account__meta">Loading your details…</p>
            )}
            {profile.status === 'error' && (
              <p className="student-account__meta">
                Student details unavailable
              </p>
            )}
            {profile.status === 'ready' && profile.fullName && (
              <p className="student-account__name">{profile.fullName}</p>
            )}
            {profile.status !== 'loading' && profile.email && (
              <p className="student-account__meta">{profile.email}</p>
            )}
          </div>

          {menuItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="student-account__item student-account__item--link"
              onClick={() => setOpen(false)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {ITEM_ICONS[item.icon ?? 'document']}
              </svg>
              {item.label}
            </Link>
          ))}

          <button
            type="button"
            className="student-account__item student-account__item--signout"
            onClick={onSignOut}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14" />
              <path d="M10 12h10M16.5 8.5 20 12l-3.5 3.5" />
            </svg>
            Sign Out
          </button>
        </div>
      )}
    </div>
  )
}

export default AccountMenu

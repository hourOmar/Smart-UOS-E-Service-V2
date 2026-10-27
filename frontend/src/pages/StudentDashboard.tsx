import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  academicRequestTypes,
  futureServices,
  notAvailableMessage,
  CATALOG_ANCHOR_ID as CATALOG_ID,
} from '../data/academicRequests'
import useStudentProfile from '../hooks/useStudentProfile'
import useToast from '../hooks/useToast'
import StudentLayout from '../components/student/StudentLayout'
import StudentWelcome from '../components/student/StudentWelcome'
import RequestCatalog, { type CatalogEntry } from '../components/student/RequestCatalog'
import RecentRequests from '../components/student/RecentRequests'
import Toast from '../components/student/Toast'
import { RECENT_REQUESTS_ANCHOR_ID } from '../utils/requestPaths'
import { rankServices, scoreService } from '../utils/serviceSearch'
import './StudentDashboard.css'

// Sections a returning page may ask the dashboard to scroll to.
const SCROLL_TARGETS = [CATALOG_ID, RECENT_REQUESTS_ANCHOR_ID]

// The five real services, then those planned for a future release, in the
// final prototype's order.
const CATALOG: CatalogEntry[] = [
  ...academicRequestTypes.map((request) => ({ kind: 'service' as const, request })),
  ...futureServices.map((service) => ({ kind: 'future' as const, service })),
]

function StudentDashboard() {
  const location = useLocation()
  const [query, setQuery] = useState('')
  const { retry, ...profile } = useStudentProfile()
  const toast = useToast()

  // Returning from a service-details page lands on the catalog, as the
  // prototype's "Academic Requests" breadcrumb does; returning from a
  // request opened in Recent Requests lands back on that section.
  const requested = (location.state as { scrollTo?: string } | null)?.scrollTo
  const scrollTarget = requested && SCROLL_TARGETS.includes(requested) ? requested : null

  useEffect(() => {
    if (scrollTarget) {
      document.getElementById(scrollTarget)?.scrollIntoView({ block: 'start' })
    }
  }, [scrollTarget])

  // Best match first (name, then keywords, then description).
  const visibleEntries = useMemo(
    () =>
      rankServices(CATALOG, (entry) =>
        entry.kind === 'service'
          ? scoreService(query, entry.request.name, entry.request.keywords, entry.request.description)
          : scoreService(query, entry.service.name, entry.service.keywords),
      ),
    [query],
  )

  // Nothing is submitted: the student is only told the service is not ready.
  const handleUnavailable = (name: string, kind: CatalogEntry['kind']) => {
    toast.show(
      kind === 'future'
        ? notAvailableMessage(name)
        : `The ${name} request form is not available yet. It is planned for a future release.`,
    )
  }

  return (
    <StudentLayout profile={profile}>
      <StudentWelcome
        status={profile.status}
        firstName={profile.firstName}
        onRetry={retry}
      />

      <RequestCatalog
        id={CATALOG_ID}
        entries={visibleEntries}
        query={query}
        onQueryChange={setQuery}
        onClearSearch={() => setQuery('')}
        onUnavailable={handleUnavailable}
      />

      <RecentRequests />

      <Toast message={toast.message} onDismiss={toast.dismiss} />
    </StudentLayout>
  )
}

export default StudentDashboard

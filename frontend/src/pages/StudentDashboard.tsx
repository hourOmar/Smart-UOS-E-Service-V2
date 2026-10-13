import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  academicRequestTypes,
  CATALOG_ANCHOR_ID as CATALOG_ID,
} from '../data/academicRequests'
import useStudentProfile from '../hooks/useStudentProfile'
import StudentLayout from '../components/student/StudentLayout'
import StudentWelcome from '../components/student/StudentWelcome'
import RequestCatalog from '../components/student/RequestCatalog'
import RecentRequests from '../components/student/RecentRequests'
import { RECENT_REQUESTS_ANCHOR_ID } from '../utils/requestPaths'
import './StudentDashboard.css'

// Sections a returning page may ask the dashboard to scroll to.
const SCROLL_TARGETS = [CATALOG_ID, RECENT_REQUESTS_ANCHOR_ID]

function StudentDashboard() {
  const location = useLocation()
  const [query, setQuery] = useState('')
  const { retry, ...profile } = useStudentProfile()

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

  // Every word typed must appear in the request's name, description or
  // search keywords.
  const visibleRequests = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) return academicRequestTypes

    return academicRequestTypes.filter((request) => {
      const text =
        `${request.name} ${request.description} ${request.keywords}`.toLowerCase()
      return words.every((word) => text.includes(word))
    })
  }, [query])

  return (
    <StudentLayout profile={profile}>
      <StudentWelcome
        status={profile.status}
        firstName={profile.firstName}
        onRetry={retry}
      />

      <RequestCatalog
        id={CATALOG_ID}
        requests={visibleRequests}
        query={query}
        onQueryChange={setQuery}
        onClearSearch={() => setQuery('')}
      />

      <RecentRequests />
    </StudentLayout>
  )
}

export default StudentDashboard

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { findSearchTarget } from '../../services/adminRequests'
import { SEARCH_MESSAGES, classifySearchInput, isSignedOutError } from '../../utils/adminSearch'
import { reviewPathFor, studentProfilePath } from '../../utils/adminPaths'
import HeroBackdrop from '../student/HeroBackdrop'

type SearchState = { kind: 'idle' } | { kind: 'searching' } | { kind: 'message'; text: string }

// Admin home hero (light design of prototype v3): find a student or a
// request by its exact ID and open its page directly: a request opens its
// existing review page, a student opens the Student Profile. Nothing is
// previewed here; only problems are shown under the search bar.
function AdminSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [state, setState] = useState<SearchState>({ kind: 'idle' })
  // Guards against a second submission before React re-renders the disabled
  // button, and ignores a result that arrives after the page was left.
  const busyRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busyRef.current) return

    const input = classifySearchInput(query)
    if (input.kind === 'empty') {
      setState({ kind: 'message', text: SEARCH_MESSAGES.empty })
      return
    }
    if (input.kind === 'invalid') {
      setState({ kind: 'message', text: SEARCH_MESSAGES.invalid })
      return
    }

    busyRef.current = true
    setState({ kind: 'searching' })
    try {
      const target = await findSearchTarget(input)
      if (!mountedRef.current) return
      if (!target) {
        setState({
          kind: 'message',
          text: input.kind === 'student' ? SEARCH_MESSAGES.studentNotFound(input.id) : SEARCH_MESSAGES.requestNotFound(input.id),
        })
        return
      }
      if (target.kind === 'student') {
        navigate(studentProfilePath(target.studentId))
        return
      }
      const path = reviewPathFor(target.type, target.requestId)
      if (!path) {
        setState({ kind: 'message', text: SEARCH_MESSAGES.noReviewPage(target.requestId, target.type) })
        return
      }
      navigate(path, { state: { from: 'dashboard' } })
    } catch (error) {
      if (!mountedRef.current) return
      setState({ kind: 'message', text: isSignedOutError(error) ? SEARCH_MESSAGES.signedOut : SEARCH_MESSAGES.failed })
    } finally {
      busyRef.current = false
      if (mountedRef.current) setState((current) => (current.kind === 'searching' ? { kind: 'idle' } : current))
    }
  }

  const message = state.kind === 'message' ? state.text : null
  const searching = state.kind === 'searching'

  return (
    <section className="adm-hero" aria-labelledby="adm-hero-title">
      <HeroBackdrop />
      <div className="adm-hero__glow" aria-hidden="true" />
      <div className="adm-hero__content">
        <span className="adm-hero__kicker">Registrar's Office · Administration</span>
        <h1 id="adm-hero-title" className="adm-hero__title">
          Find a student or request
        </h1>

        <form role="search" className="adm-search" onSubmit={handleSubmit} noValidate aria-busy={searching}>
          <label htmlFor="adm-search-input" className="student-visually-hidden">
            Student ID or request ID
          </label>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            id="adm-search-input"
            type="search"
            autoComplete="off"
            placeholder="Enter student ID or request ID"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              if (state.kind === 'message') setState({ kind: 'idle' })
            }}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? 'adm-search-msg' : undefined}
          />
          <button type="submit" disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>

        <div className="adm-search__outcome" aria-live="polite">
          {searching && (
            <span className="student-visually-hidden" role="status">
              Searching…
            </span>
          )}
          {message && (
            <div id="adm-search-msg" className="adm-search__msg" role="alert">
              <span aria-hidden="true">✕</span>
              <span>{message}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default AdminSearch

import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  searchStudentOrRequest,
  type SearchResult,
} from '../../services/adminRequests'
import { formatDate } from '../../services/studentRequests'
import RequestStatusBadge from '../requests/RequestStatusBadge'

type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'message'; text: string }
  | { kind: 'found'; result: Exclude<SearchResult, null> }

// Admin home hero: find a student or a request by its exact ID. The match
// is shown here; its own page will be linked once that page exists.
function AdminSearch() {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<SearchState>({ kind: 'idle' })
  const searchId = useRef(0)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const q = query.trim()
    if (!q) {
      setState({ kind: 'message', text: 'Enter a student ID or a request ID.' })
      return
    }

    const id = ++searchId.current
    setState({ kind: 'searching' })
    try {
      const result = await searchStudentOrRequest(q)
      if (id !== searchId.current) return
      setState(
        result
          ? { kind: 'found', result }
          : { kind: 'message', text: `No student or request matches “${q}”. Check the ID and try again.` },
      )
    } catch {
      if (id !== searchId.current) return
      setState({ kind: 'message', text: 'The search couldn’t be completed. Check your connection and try again.' })
    }
  }

  const message = state.kind === 'message' ? state.text : null

  return (
    <section className="adm-hero" aria-labelledby="adm-hero-title">
      <div className="adm-hero__content">
        <span className="adm-hero__kicker">Registrar's Office · Administration</span>
        <h1 id="adm-hero-title" className="adm-hero__title">
          Find a student or request
        </h1>

        <form role="search" className="adm-search" onSubmit={handleSubmit} noValidate>
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
            onChange={(event) => setQuery(event.target.value)}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? 'adm-search-msg' : undefined}
          />
          <button type="submit" disabled={state.kind === 'searching'}>
            {state.kind === 'searching' ? 'Searching…' : 'Search'}
          </button>
        </form>

        <div className="adm-search__outcome" aria-live="polite">
          {message && (
            <div id="adm-search-msg" className="adm-search__msg" role="alert">
              <span aria-hidden="true">✕</span>
              <span>{message}</span>
            </div>
          )}
          {state.kind === 'found' && <SearchMatch result={state.result} />}
        </div>
      </div>
    </section>
  )
}

function SearchMatch({ result }: { result: Exclude<SearchResult, null> }) {
  if (result.kind === 'student') {
    return (
      <article className="adm-match" aria-label="Matching student">
        <span className="adm-match__kind">Student</span>
        <h2 className="adm-match__title">{result.name ?? '—'}</h2>
        <dl className="adm-match__fields">
          <div>
            <dt>Student ID</dt>
            <dd className="adm-mono">{result.studentId}</dd>
          </div>
          {result.email && (
            <div>
              <dt>Email</dt>
              <dd>{result.email}</dd>
            </div>
          )}
          {result.program && (
            <div>
              <dt>Program</dt>
              <dd>{result.program}</dd>
            </div>
          )}
          <div>
            <dt>Requests</dt>
            <dd>
              {result.totalRequests} total · {result.inProgress} In Progress
            </dd>
          </div>
        </dl>
      </article>
    )
  }

  const { request, summary } = result
  return (
    <article className="adm-match" aria-label="Matching request">
      <span className="adm-match__kind">Request</span>
      <div className="adm-match__row">
        <h2 className="adm-match__title adm-mono">{request.id}</h2>
        <RequestStatusBadge status={request.status} requestType={request.type} />
      </div>
      <dl className="adm-match__fields">
        <div>
          <dt>Request type</dt>
          <dd>{request.type}</dd>
        </div>
        <div>
          <dt>Student</dt>
          <dd>
            {request.studentName ?? '—'} ·{' '}
            <span className="adm-mono">{request.studentId}</span>
          </dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{formatDate(request.date)}</dd>
        </div>
        {summary && (
          <div className="adm-match__wide">
            <dt>Summary</dt>
            <dd>{summary}</dd>
          </div>
        )}
      </dl>
    </article>
  )
}

export default AdminSearch

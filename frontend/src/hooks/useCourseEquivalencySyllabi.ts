import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, SyllabusUploadError, fetchSyllabi, uploadSyllabus } from '../services/courseEquivalencyReview'
import type { SyllabusSide } from '../utils/courseEquivalencyEvaluation'
import { replacesFor, shouldReloadAfter, validateSyllabusFile, type SyllabiState } from '../utils/courseEquivalencySyllabi'

export interface SideUpload {
  busy: boolean
  /** 0..1 while the file is being sent; null otherwise. */
  progress: number | null
  error: string | null
  message: string | null
}

const IDLE: SideUpload = { busy: false, progress: null, error: null, message: null }

interface State {
  forId: string
  status: 'loading' | 'ready' | 'error'
  data: SyllabiState | null
  error: string | null
}

// The two syllabi of a Course Equivalency request (Phase 3B endpoints): the current
// version and history per side, and uploads / replacements with progress. Every upload
// names the version it replaces (or 'none'), so a concurrent change by another staff member
// is refused by the backend instead of silently replacing their file. After a successful
// upload the list is re-read and `onUploaded` is called (the evaluation state may change:
// the request may become eligible, or the saved result outdated).
function useCourseEquivalencySyllabi(requestId: string | undefined, onUploaded: () => void) {
  const [state, setState] = useState<State | null>(null)
  const [uploads, setUploads] = useState<Record<SyllabusSide, SideUpload>>({ old: IDLE, new: IDLE })
  const [attempt, setAttempt] = useState(0)
  const stateRef = useRef<State | null>(null)
  const onUploadedRef = useRef(onUploaded)

  useEffect(() => {
    stateRef.current = state
    onUploadedRef.current = onUploaded
  })

  useEffect(() => {
    if (!requestId) return
    let cancelled = false
    fetchSyllabi(requestId)
      .then((data) => {
        if (!cancelled) setState({ forId: requestId, status: 'ready', data, error: null })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof ApiError ? error.message : 'The syllabus service could not be reached.'
        setState((prev) =>
          prev && prev.forId === requestId && prev.data ? prev : { forId: requestId, status: 'error', data: null, error: message },
        )
      })
    return () => {
      cancelled = true
    }
  }, [requestId, attempt])

  const reload = useCallback(() => setAttempt((count) => count + 1), [])

  const setSide = (side: SyllabusSide, patch: Partial<SideUpload>) =>
    setUploads((prev) => ({ ...prev, [side]: { ...prev[side], ...patch } }))

  const upload = useCallback(
    async (side: SyllabusSide, file: File) => {
      const now = stateRef.current
      if (!requestId || !now?.data || now.forId !== requestId) return
      const invalid = validateSyllabusFile(file)
      if (invalid) {
        setSide(side, { error: invalid, message: null })
        return
      }
      setSide(side, { busy: true, progress: 0, error: null, message: null })
      try {
        const result = await uploadSyllabus(requestId, side, file, replacesFor(now.data, side), (fraction) =>
          setSide(side, { progress: fraction }),
        )
        setSide(side, {
          busy: false,
          progress: null,
          message: result.superseded_syllabus_id ? 'Syllabus replaced. The previous version is kept in the history.' : 'Syllabus uploaded.',
        })
        reload()
        onUploadedRef.current()
      } catch (error) {
        const failure = error instanceof SyllabusUploadError ? error : new SyllabusUploadError(0, null, 'The upload failed.')
        setSide(side, { busy: false, progress: null, error: failure.message })
        if (shouldReloadAfter(failure.code) || failure.status === 409) reload()
      }
    },
    [requestId, reload],
  )

  const current = state && requestId && state.forId === requestId ? state : null
  return {
    status: current?.status ?? 'loading',
    data: current?.data ?? null,
    error: current?.error ?? null,
    uploads,
    upload,
    reload,
  }
}

export default useCourseEquivalencySyllabi

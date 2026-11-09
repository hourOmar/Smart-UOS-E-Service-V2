import { useEffect, useRef, useState } from 'react'
import { ProofDocumentError, openProofDocument } from '../../services/incompleteExamReview'
import { proofFileName, proofMimeType } from '../../utils/incompleteExamRecord'
import { STUDENT_DOCUMENT_ERROR_MESSAGES, displayProofName } from '../../utils/incompleteExamSubmission'

interface StudentProofDocumentsProps {
  requestId: string
  /** Stored paths (<Request_ID>/<file>) from Incomplete_Exam.Proof_Files. */
  paths: string[]
}

type Action = 'open' | 'download'

// The supporting documents the student submitted with an Incomplete Exam
// request. Read-only: nothing can be added, replaced or removed after
// submission. A document is downloaded only when the student clicks Open or
// Download, privately with the student's own session (the existing
// "read own request's files" Storage policy; no public or signed link), its
// path, type and contents are checked (openProofDocument), and the browser
// gets a temporary local URL that is released when this page closes. No AI
// evaluation details are shown here.
function StudentProofDocuments({ requestId, paths }: StudentProofDocumentsProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const revokers = useRef<(() => void)[]>([])

  useEffect(() => {
    const list = revokers.current
    return () => {
      for (const revoke of list.splice(0)) revoke()
    }
  }, [])

  const handle = async (path: string, label: string, action: Action) => {
    if (busy) return
    // A new tab must be opened during the click itself, or the browser blocks it.
    const tab = action === 'open' ? window.open('', '_blank') : null
    if (tab) tab.opener = null
    setBusy(path)
    setErrors((prev) => ({ ...prev, [path]: '' }))
    try {
      const opened = await openProofDocument(requestId, path)
      revokers.current.push(opened.revoke)
      if (action === 'open') {
        if (tab) tab.location.href = opened.url
        else setErrors((prev) => ({ ...prev, [path]: STUDENT_DOCUMENT_ERROR_MESSAGES.blocked_tab }))
      } else {
        const link = window.document.createElement('a')
        link.href = opened.url
        link.download = label
        link.rel = 'noopener'
        link.click()
      }
    } catch (error) {
      tab?.close()
      const reason = error instanceof ProofDocumentError ? error.reason : 'unavailable'
      setErrors((prev) => ({
        ...prev,
        [path]: STUDENT_DOCUMENT_ERROR_MESSAGES[reason] ?? STUDENT_DOCUMENT_ERROR_MESSAGES.unavailable,
      }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="req-panel" aria-labelledby="req-docs-title">
      <h2 id="req-docs-title" className="req-panel__title">
        Supporting documents
      </h2>
      <div className="req-panel__body">
        {paths.length === 0 ? (
          <p className="req-docs__empty">No supporting documents were submitted with this request.</p>
        ) : (
          <ul className="req-docs" aria-label="Submitted documents">
            {paths.map((path, index) => {
              const label = displayProofName(requestId, path)
              const openable = Boolean(label && proofMimeType(proofFileName(requestId, path) ?? ''))
              const shown = label ?? `Document ${index + 1}`
              const error = errors[path]
              return (
                <li key={path} className="req-docs__item">
                  <div className="req-docs__text">
                    <span className="req-docs__name">{shown}</span>
                    {!openable && <span className="req-docs__meta">{STUDENT_DOCUMENT_ERROR_MESSAGES.invalid_path}</span>}
                    {error && (
                      <span className="req-docs__error" role="alert">
                        <span aria-hidden="true">✕ </span>
                        {error}
                      </span>
                    )}
                  </div>
                  {openable && (
                    <div className="req-docs__actions">
                      <button
                        type="button"
                        className="req-docs__button"
                        onClick={() => void handle(path, shown, 'open')}
                        disabled={busy !== null}
                        aria-busy={busy === path || undefined}
                      >
                        {busy === path ? 'Opening…' : 'Open'}
                        <span className="student-visually-hidden"> {shown}</span>
                      </button>
                      <button
                        type="button"
                        className="req-docs__button"
                        onClick={() => void handle(path, shown, 'download')}
                        disabled={busy !== null}
                      >
                        Download
                        <span className="student-visually-hidden"> {shown}</span>
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <p className="req-docs__note">
          Documents cannot be added, replaced or removed after submission. They open privately in your browser.
        </p>
      </div>
    </section>
  )
}

export default StudentProofDocuments

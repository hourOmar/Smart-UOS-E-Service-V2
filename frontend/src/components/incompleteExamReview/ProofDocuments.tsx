import { useEffect, useRef, useState } from 'react'
import { ProofDocumentError, openProofDocument } from '../../services/incompleteExamReview'
import { PROOF_ERROR_MESSAGES, proofFileName, proofMimeType } from '../../utils/incompleteExamRecord'

interface ProofDocumentsProps {
  requestId: string
  /** Storage paths (<Request_ID>/<file>) from the Incomplete_Exam row. */
  paths: string[]
  /** The student's typed proof description (not a document). */
  description: string | null
  /** How the newest completed evaluation used each path, if any. */
  outcomes: Map<string, string>
}

type Action = 'open' | 'download'

// The supporting proof documents. Nothing is downloaded until staff click
// Open or Download; each click downloads the file privately with the staff
// member's own session (no public or signed link), checks its type and
// contents, and hands the browser a temporary local URL that is released when
// this page closes.
function ProofDocuments({ requestId, paths, description, outcomes }: ProofDocumentsProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const revokers = useRef<(() => void)[]>([])

  useEffect(() => {
    const list = revokers.current
    return () => {
      for (const revoke of list.splice(0)) revoke()
    }
  }, [])

  const handle = async (path: string, action: Action) => {
    if (busy) return
    // A new tab must be opened during the click itself, or the browser blocks it.
    const tab = action === 'open' ? window.open('', '_blank') : null
    if (tab) tab.opener = null
    setBusy(path)
    setErrors((prev) => ({ ...prev, [path]: '' }))
    try {
      const proof = await openProofDocument(requestId, path)
      revokers.current.push(proof.revoke)
      if (action === 'open') {
        if (tab) tab.location.href = proof.url
        else setErrors((prev) => ({ ...prev, [path]: 'The browser blocked the new tab. Use Download instead.' }))
      } else {
        const link = document.createElement('a')
        link.href = proof.url
        link.download = proof.name
        link.rel = 'noopener'
        link.click()
      }
    } catch (error) {
      tab?.close()
      const message = error instanceof ProofDocumentError ? error.message : PROOF_ERROR_MESSAGES.unavailable
      setErrors((prev) => ({ ...prev, [path]: message }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="req-panel rv-panel" aria-labelledby="ier-proof-title">
      <h2 id="ier-proof-title" className="req-panel__title">
        Supporting proof
      </h2>
      <div className="req-panel__body">
        <div className="req-text">
          <span className="req-text__label">Student’s proof description</span>
          {description ? <p className="req-text__body">{description}</p> : <p className="rv-missing">Not recorded</p>}
        </div>

        {paths.length === 0 ? (
          <p className="rv-muted">No proof document was uploaded with this request.</p>
        ) : (
          <ul className="ier-proofs">
            {paths.map((path) => {
              const name = proofFileName(requestId, path)
              const openable = Boolean(name && proofMimeType(name))
              const error = errors[path]
              const outcome = outcomes.get(path)
              return (
                <li key={path} className="ier-proof">
                  <div className="ier-proof__text">
                    <span className="ier-proof__name">{name ?? 'Unrecognised file location'}</span>
                    {outcome && <span className="ier-proof__meta">{outcome}</span>}
                    {!openable && (
                      <span className="ier-proof__meta">
                        {name ? PROOF_ERROR_MESSAGES.unsupported_type : PROOF_ERROR_MESSAGES.invalid_path}
                      </span>
                    )}
                    {error && (
                      <span className="rv-field-error" role="alert">
                        ✕ {error}
                      </span>
                    )}
                  </div>
                  {openable && (
                    <div className="ier-proof__actions">
                      <button
                        type="button"
                        className="pcr-rerun"
                        onClick={() => void handle(path, 'open')}
                        disabled={busy !== null}
                        aria-busy={busy === path || undefined}
                      >
                        {busy === path ? 'Opening…' : 'Open'}
                        <span className="student-visually-hidden"> {name}</span>
                      </button>
                      <button
                        type="button"
                        className="pcr-rerun"
                        onClick={() => void handle(path, 'download')}
                        disabled={busy !== null}
                      >
                        Download
                        <span className="student-visually-hidden"> {name}</span>
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <span className="rv-muted">Files open only when you click, using your staff session. No public link is created.</span>
      </div>
    </section>
  )
}

export default ProofDocuments

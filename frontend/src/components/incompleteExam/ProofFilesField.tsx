import type { ChangeEvent } from 'react'
import type { ProofEntry } from '../../services/incompleteExamSubmission'
import {
  MAX_PROOF_FILES,
  PROOF_STATUS_LABELS,
  PROOF_UPLOAD_ERROR_MESSAGES,
  formatFileSize,
} from '../../utils/incompleteExamSubmission'

interface ProofFilesFieldProps {
  entries: ProofEntry<File>[]
  /** Why files the student just chose were not added. */
  messages: string[]
  onAdd: (event: ChangeEvent<HTMLInputElement>) => void
  onRemove: (id: string) => void
  /** True while a submission is running: no adding or removing. */
  locked: boolean
}

// Optional supporting PDFs, chosen before Submit. Each file shows its upload
// status; a file that could not be uploaded must be removed and selected
// again. Nothing here talks to Storage (the submission does).
function ProofFilesField({ entries, messages, onAdd, onRemove, locked }: ProofFilesFieldProps) {
  const full = entries.length >= MAX_PROOF_FILES
  const total = entries.reduce((sum, e) => sum + e.file.size, 0)

  return (
    <div className="rc-field ie-files">
      <span className="rc-field__label" id="ie-files-label">
        Supporting documents (optional)
      </span>

      {/* The upload area: its button opens the file picker (there is no drag
          and drop). It grows to list the chosen files. */}
      <div className="ie-drop" data-disabled={locked || full || undefined}>
        <span className="ie-drop__icon" aria-hidden="true">
          {/* file-up, from Lucide (lucide.dev, ISC licence) */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
            <path d="M14 2v4a2 2 0 0 0 2 2h4" />
            <path d="M12 12v6" />
            <path d="m15 15-3-3-3 3" />
          </svg>
        </span>
        <span className="ie-drop__title">Add supporting documents</span>

        <input
          id="ie-files-input"
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="student-visually-hidden"
          onChange={onAdd}
          disabled={locked || full}
          aria-labelledby="ie-files-label"
          aria-describedby="ie-files-help ie-files-note"
        />
        <label htmlFor="ie-files-input" className="ie-drop__button" aria-disabled={locked || full || undefined}>
          Choose PDF files
        </label>

        <span id="ie-files-help" className="ie-drop__limits">
          PDF only · Max {MAX_PROOF_FILES} files · 10 MB each · 18 MB total
        </span>
        <span className="ie-files__count">
          {entries.length} of {MAX_PROOF_FILES} files selected
          {entries.length > 0 ? ` · ${formatFileSize(total)}` : ''}
        </span>

        {entries.length > 0 && (
          <ul className="ie-files__list" aria-live="polite" aria-label="Selected documents">
            {entries.map((entry) => (
              <li key={entry.id} className="ie-file" data-status={entry.status}>
                <span className="ie-file__info">
                  <span className="ie-file__name">{entry.file.name}</span>
                  <span className="ie-file__meta">
                    {formatFileSize(entry.file.size)} ·{' '}
                    <span className="ie-file__status">{PROOF_STATUS_LABELS[entry.status]}</span>
                  </span>
                  {entry.status === 'failed' && entry.error && (
                    <span className="rc-error ie-file__error">
                      <span aria-hidden="true">✕ </span>
                      {PROOF_UPLOAD_ERROR_MESSAGES[entry.error]}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="rc-button ie-file__remove"
                  onClick={() => onRemove(entry.id)}
                  disabled={locked}
                  aria-label={`Remove ${entry.file.name}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {messages.length > 0 && (
        <ul className="ie-files__messages" role="alert">
          {messages.map((message) => (
            <li key={message} className="rc-error">
              <span aria-hidden="true">✕ </span>
              {message}
            </li>
          ))}
        </ul>
      )}

      <p id="ie-files-note" className="ie-files__note">
        Documents cannot be added, replaced, or removed after submission.
      </p>
    </div>
  )
}

export default ProofFilesField

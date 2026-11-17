import { useRef, useState } from 'react'
import { DOWNLOAD_MESSAGES, SyllabusDownloadError, downloadSyllabus } from '../../services/courseEquivalencyReview'
import type { SideUpload } from '../../hooks/useCourseEquivalencySyllabi'
import type { EvaluatedSyllabus, SyllabusSide } from '../../utils/courseEquivalencyEvaluation'
import {
  SIDE_HINTS,
  SIDE_TITLES,
  SYLLABUS_ACCEPT,
  fileTypeLabel,
  formatBytes,
  sourceLabel,
  type SyllabiState,
} from '../../utils/courseEquivalencySyllabi'
import { formatDateTime } from '../review/format'

interface SyllabusPanelProps {
  requestId: string
  side: SyllabusSide
  status: 'loading' | 'ready' | 'error'
  data: SyllabiState | null
  error: string | null
  upload: SideUpload
  onUpload: (side: SyllabusSide, file: File) => void
  onReload: () => void
  /** The version the current evaluation used, to mark a replaced (outdated) file. */
  evaluated: EvaluatedSyllabus | null
}

// One side of the request's syllabi (Phase 3B): the current file with its details,
// authorized staff download (private bucket, staff session), and upload / replacement with
// progress and validation errors. Replacing keeps the earlier versions in the history.
function SyllabusPanel({ requestId, side, status, data, error, upload, onUpload, onReload, evaluated }: SyllabusPanelProps) {
  const input = useRef<HTMLInputElement>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const sideState = data?.sides[side] ?? null
  const current = sideState?.current ?? null
  const versions = sideState?.versions.length ?? 0
  const canUpload = Boolean(data?.can_upload) && !upload.busy
  const titleId = `cer-syllabus-${side}-title`

  const download = async () => {
    if (!current) return
    setDownloading(true)
    setDownloadError(null)
    try {
      await downloadSyllabus(requestId, current)
    } catch (e) {
      setDownloadError(e instanceof SyllabusDownloadError ? e.message : DOWNLOAD_MESSAGES.unavailable)
    } finally {
      setDownloading(false)
    }
  }

  const chosen = (files: FileList | null) => {
    const file = files?.[0]
    if (input.current) input.current.value = ''
    if (file) onUpload(side, file)
  }

  return (
    <section className="req-panel rv-panel cer-syllabus" aria-labelledby={titleId} aria-busy={upload.busy}>
      <h2 id={titleId} className="req-panel__title">
        {SIDE_TITLES[side]}
      </h2>
      <div className="req-panel__body">
        <p className="rv-muted cer-syllabus__hint">{SIDE_HINTS[side]}</p>
        {status === 'loading' && <p className="rv-muted" role="status">Loading the syllabus…</p>}
        {status === 'error' && !data && (
          <div className="rv-notice" role="alert">
            {error}{' '}
            <button type="button" className="pcr-rerun" onClick={onReload}>
              Try again
            </button>
          </div>
        )}
        {data && !current && (
          <p className="cer-syllabus__missing" role="status">
            <span aria-hidden="true">○ </span>No syllabus uploaded yet. The eligibility check needs both syllabi.
          </p>
        )}
        {current && (
          <div className="ier-proof cer-syllabus__file">
            <div className="ier-proof__text">
              <span className="ier-proof__name">{current.file_name}</span>
              <span className="ier-proof__meta">
                {[fileTypeLabel(current.mime_type), formatBytes(current.size_bytes), formatDateTime(current.uploaded_at)]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <span className="ier-proof__meta">
                {sourceLabel(current)}
                {versions > 1 ? ` · version ${versions} (${versions - 1} earlier kept)` : ''}
              </span>
              {evaluated && evaluated.syllabus_id !== current.syllabus_id && (
                <span className="cer-syllabus__stale" role="note">
                  Replaced after the current evaluation (it used “{evaluated.file_name}”).
                </span>
              )}
            </div>
            <div className="ier-proof__actions">
              <button type="button" className="pcr-rerun" onClick={() => void download()} disabled={downloading}>
                {downloading ? 'Downloading…' : 'Download'}
                <span className="student-visually-hidden"> {SIDE_TITLES[side]}</span>
              </button>
            </div>
          </div>
        )}
        {downloadError && (
          <p className="rv-notice" role="alert">
            {downloadError}
          </p>
        )}

        {data && (
          <div className="cer-upload">
            <input
              ref={input}
              id={`cer-upload-${side}`}
              type="file"
              accept={SYLLABUS_ACCEPT}
              className="student-visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => chosen(event.target.files)}
              disabled={!canUpload}
            />
            <button
              type="button"
              className="pcr-primary"
              onClick={() => input.current?.click()}
              disabled={!canUpload}
              title={!data.can_upload ? 'Syllabi can be uploaded only while the request is In Progress.' : undefined}
            >
              {upload.busy ? 'Uploading…' : current ? 'Replace syllabus' : 'Upload syllabus'}
            </button>
            <span className="rv-muted cer-upload__rules">PDF or Word (.docx), up to 10 MB.</span>
            {!data.can_upload && (
              <span className="rv-muted cer-upload__rules">Uploads are closed: the request is no longer In Progress.</span>
            )}
          </div>
        )}
        {upload.progress !== null && (
          <div className="cer-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100}
               aria-valuenow={Math.round(upload.progress * 100)} aria-label={`Uploading the ${SIDE_TITLES[side].toLowerCase()}`}>
            <span className="cer-progress__bar" style={{ width: `${Math.round(upload.progress * 100)}%` }} />
          </div>
        )}
        {upload.error && (
          <p className="rv-notice" role="alert">
            {upload.error}
          </p>
        )}
        {upload.message && (
          <p className="cer-upload__done" role="status">
            {upload.message}
          </p>
        )}
      </div>
    </section>
  )
}

export default SyllabusPanel

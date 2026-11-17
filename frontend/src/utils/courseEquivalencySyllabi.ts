// Course Equivalency syllabi on the staff review page: the Phase 3B upload endpoints'
// shapes, client-side checks before an upload, the replacement reference and the error
// messages. Pure functions only, so they can be tested with `npm test`.

import type { SyllabusSide } from './courseEquivalencyEvaluation.ts'

export const SYLLABUS_BUCKET = 'course-syllabi'
export const SYLLABUS_MAX_BYTES = 10 * 1024 * 1024
export const PDF_MIME = 'application/pdf'
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const SYLLABUS_ACCEPT = `.pdf,.docx,${PDF_MIME},${DOCX_MIME}`

export const SIDE_TITLES: Record<SyllabusSide, string> = {
  old: 'Old Course Syllabus',
  new: 'New Course Syllabus',
}

export const SIDE_HINTS: Record<SyllabusSide, string> = {
  old: 'The course the student already completed.',
  new: 'The course the student wants it to count for.',
}

export interface SyllabusRow {
  syllabus_id: string
  request_id: string
  side: SyllabusSide
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  sha256: string | null
  source: 'legacy_import' | 'staff_upload' | string
  uploaded_by_staff_id: number | null
  uploaded_at: string | null
  registered_at: string | null
  is_current: boolean
  superseded_at: string | null
}

export interface SyllabiState {
  request_id: string
  request_status: string
  can_upload: boolean
  ready: boolean
  sides: Record<SyllabusSide, { current: SyllabusRow | null; versions: SyllabusRow[] }>
  limits: { max_bytes: number; max_versions_per_side: number; allowed_types: string[] }
}

export interface SyllabusUploadResult {
  syllabus: SyllabusRow
  superseded_syllabus_id: string | null
}

const BASE = '/api/staff/course-equivalency'

export const syllabiPath = (requestId: string) => `${BASE}/${encodeURIComponent(requestId)}/syllabi`
export const syllabusUploadPath = (requestId: string, side: SyllabusSide) =>
  `${BASE}/${encodeURIComponent(requestId)}/syllabi/${side}`

/** A message when the file cannot be accepted, before anything is sent; null when it may be uploaded. */
export function validateSyllabusFile(file: { name: string; size: number }): string | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.doc')) return 'Old Word (.doc) files are not accepted. Save it as .docx or PDF.'
  if (!name.endsWith('.pdf') && !name.endsWith('.docx')) return 'Only PDF and Word (.docx) files are accepted.'
  if (file.size === 0) return 'The file is empty.'
  if (file.size > SYLLABUS_MAX_BYTES) return 'The file is larger than 10 MB.'
  return null
}

/** The `replaces` reference for an upload: the current version's ID (replace exactly that
 *  version), or 'none' (there must be no current version yet). The backend refuses the upload
 *  if another staff member changed the side in between. */
export function replacesFor(state: SyllabiState | null, side: SyllabusSide): string {
  return state?.sides[side]?.current?.syllabus_id ?? 'none'
}

const UPLOAD_STATUS_MESSAGES: Record<number, string> = {
  0: 'The upload service could not be reached. Check your connection and try again.',
  401: 'Your session has expired. Sign in again.',
  403: 'This page is for staff only.',
  404: 'This Course Equivalency request was not found.',
  409: 'The syllabus could not be uploaded now. The current files were reloaded; check them and try again.',
  413: 'The file is larger than 10 MB.',
  415: 'Only PDF and Word (.docx) files are accepted.',
  503: 'The upload service is unavailable. Try again shortly.',
}

/** The staff-facing message for a failed upload: the backend's own safe message when it sent
 *  one ({"detail": {"code", "message"}}), otherwise a message for the HTTP status. */
export function uploadErrorMessage(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (detail && typeof detail === 'object') {
    const message = (detail as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return UPLOAD_STATUS_MESSAGES[status] ?? (status >= 500 ? UPLOAD_STATUS_MESSAGES[503] : `The upload failed (${status}).`)
}

export function uploadErrorCode(body: unknown): string | null {
  const detail = (body as { detail?: unknown } | null)?.detail
  const code = detail && typeof detail === 'object' ? (detail as { code?: unknown }).code : null
  return typeof code === 'string' ? code : null
}

/** These refusals mean the side changed or is busy: reload what is current. */
export function shouldReloadAfter(code: string | null): boolean {
  return code === 'syllabus_changed' || code === 'upload_in_progress' || code === 'request_not_in_progress'
}

export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function fileTypeLabel(mime: string): string {
  return mime === PDF_MIME ? 'PDF' : mime === DOCX_MIME ? 'Word (.docx)' : mime
}

export function sourceLabel(row: SyllabusRow): string {
  if (row.source === 'legacy_import') return 'Imported from the earlier upload system'
  return row.uploaded_by_staff_id == null ? 'Uploaded by staff' : `Uploaded by Staff ID ${row.uploaded_by_staff_id}`
}

/** A registered path must lie inside this request's folder (defence in depth before a download). */
export function pathBelongsTo(requestId: string, path: string): boolean {
  return path.startsWith(`${requestId}/`) && !path.split('/').some((part) => part === '..' || part === '')
}

/** The downloaded bytes must be the registered type: PDF starts with %PDF-, DOCX is a ZIP. */
export function downloadContentMatches(mime: string, head: Uint8Array): boolean {
  if (mime === PDF_MIME) return head.length >= 5 && String.fromCharCode(...head.slice(0, 5)) === '%PDF-'
  if (mime === DOCX_MIME) return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
  return false
}

/** A safe local file name for the downloaded copy. */
export function downloadName(row: SyllabusRow): string {
  const ext = row.mime_type === PDF_MIME ? '.pdf' : row.mime_type === DOCX_MIME ? '.docx' : ''
  const base = Array.from(row.file_name || `${row.side}-course-syllabus`, (ch) =>
    ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch,
  )
    .join('')
    .trim()
  return base.toLowerCase().endsWith(ext) ? base : `${base}${ext}`
}

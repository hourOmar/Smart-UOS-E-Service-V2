// Syllabus upload and replacement on the Course Equivalency review page: client-side checks,
// the replacement reference, error messages from the Phase 3B endpoints, safe downloads.
// Run: npm test (no browser, backend or database).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  DOCX_MIME,
  PDF_MIME,
  SYLLABUS_MAX_BYTES,
  downloadContentMatches,
  downloadName,
  formatBytes,
  pathBelongsTo,
  replacesFor,
  shouldReloadAfter,
  sourceLabel,
  syllabiPath,
  syllabusUploadPath,
  uploadErrorCode,
  uploadErrorMessage,
  validateSyllabusFile,
  type SyllabiState,
  type SyllabusRow,
} from '../src/utils/courseEquivalencySyllabi.ts'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const SERVICE = source('../src/services/courseEquivalencyReview.ts')
const HOOK = source('../src/hooks/useCourseEquivalencySyllabi.ts')
const PANEL = source('../src/components/courseEquivalencyReview/SyllabusPanel.tsx')
const RID = 'STUD_EQVO_ECTU_000139'

function row(overrides: Partial<SyllabusRow> = {}): SyllabusRow {
  return {
    syllabus_id: '11111111-1111-4111-8111-111111111111', request_id: RID, side: 'old',
    storage_path: `${RID}/old/11111111-1111-4111-8111-111111111111.pdf`, file_name: 'Calculus I for Engineers.pdf',
    mime_type: PDF_MIME, size_bytes: 2048, sha256: 'a'.repeat(64), source: 'staff_upload', uploaded_by_staff_id: 100001,
    uploaded_at: '2026-11-17T08:00:00Z', registered_at: '2026-11-17T08:00:01Z', is_current: true, superseded_at: null, ...overrides,
  }
}

function syllabi(current: SyllabusRow | null): SyllabiState {
  return {
    request_id: RID, request_status: 'In Progress', can_upload: true, ready: false,
    sides: { old: { current, versions: current ? [current] : [] }, new: { current: null, versions: [] } },
    limits: { max_bytes: SYLLABUS_MAX_BYTES, max_versions_per_side: 20, allowed_types: [PDF_MIME, DOCX_MIME] },
  }
}

test('endpoints of the Phase 3B syllabus API', () => {
  assert.equal(syllabiPath(RID), `/api/staff/course-equivalency/${RID}/syllabi`)
  assert.equal(syllabusUploadPath(RID, 'new'), `/api/staff/course-equivalency/${RID}/syllabi/new`)
})

test('files are checked before anything is sent', () => {
  assert.equal(validateSyllabusFile({ name: 'a.pdf', size: 10 }), null)
  assert.equal(validateSyllabusFile({ name: 'A.DOCX', size: 10 }), null)
  assert.match(validateSyllabusFile({ name: 'a.doc', size: 10 })!, /\.doc/)
  assert.match(validateSyllabusFile({ name: 'a.txt', size: 10 })!, /Only PDF/)
  assert.match(validateSyllabusFile({ name: 'a.pdf', size: 0 })!, /empty/)
  assert.match(validateSyllabusFile({ name: 'a.pdf', size: SYLLABUS_MAX_BYTES + 1 })!, /10 MB/)
  assert.equal(validateSyllabusFile({ name: 'a.pdf', size: SYLLABUS_MAX_BYTES }), null)
})

test('uploads name the exact version they replace, or none', () => {
  assert.equal(replacesFor(syllabi(null), 'old'), 'none')
  assert.equal(replacesFor(syllabi(row()), 'old'), '11111111-1111-4111-8111-111111111111')
  assert.equal(replacesFor(syllabi(row()), 'new'), 'none')
  assert.equal(replacesFor(null, 'old'), 'none')
  assert.match(HOOK, /replacesFor\(now\.data, side\)/)
  assert.match(SERVICE, /form\.append\('replaces', replaces\)/)
})

test('upload errors show the backend message, else a message for the status', () => {
  const stale = { detail: { code: 'syllabus_changed', message: 'Another staff member changed this syllabus.' } }
  assert.equal(uploadErrorMessage(409, stale), 'Another staff member changed this syllabus.')
  assert.equal(uploadErrorCode(stale), 'syllabus_changed')
  assert.equal(shouldReloadAfter('syllabus_changed'), true)
  assert.equal(shouldReloadAfter('upload_in_progress'), true)
  assert.equal(shouldReloadAfter('unsupported_type'), false)
  assert.match(uploadErrorMessage(413, null), /10 MB/)
  assert.match(uploadErrorMessage(401, null), /session/)
  assert.match(uploadErrorMessage(403, null), /staff only/)
  assert.match(uploadErrorMessage(0, null), /could not be reached/)
  assert.match(uploadErrorMessage(502, 'gateway'), /unavailable/)
  assert.equal(uploadErrorCode({ detail: 'plain' }), null)
})

test('downloads stay inside the request folder and must match the registered type', () => {
  assert.equal(pathBelongsTo(RID, `${RID}/old/x.pdf`), true)
  assert.equal(pathBelongsTo(RID, `STUD_EQVO_ECTU_000999/old/x.pdf`), false)
  assert.equal(pathBelongsTo(RID, `${RID}/../STUD_EQVO_ECTU_000999/x.pdf`), false)
  assert.equal(downloadContentMatches(PDF_MIME, new TextEncoder().encode('%PDF-1.7')), true)
  assert.equal(downloadContentMatches(PDF_MIME, new TextEncoder().encode('<html>')), false)
  assert.equal(downloadContentMatches(DOCX_MIME, new Uint8Array([0x50, 0x4b, 0x03, 0x04])), true)
  assert.equal(downloadContentMatches('text/html', new TextEncoder().encode('%PDF-1.7')), false)
  assert.equal(downloadName(row({ file_name: 'a/b:c.pdf' })), 'a_b_c.pdf')
  assert.equal(downloadName(row({ file_name: 'Plan', mime_type: DOCX_MIME })), 'Plan.docx')
  assert.match(SERVICE, /supabase\.storage\.from\(SYLLABUS_BUCKET\)\.download\(row\.storage_path\)/)
  assert.match(SERVICE, /new Blob\(\[data\], \{ type: row\.mime_type \}\)/)
})

test('file details and progress', () => {
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB')
  assert.equal(sourceLabel(row()), 'Uploaded by Staff ID 100001')
  assert.match(sourceLabel(row({ source: 'legacy_import', uploaded_by_staff_id: null })), /earlier upload system/)
  assert.match(SERVICE, /xhr\.upload\.onprogress/)
  assert.match(PANEL, /role="progressbar"/)
  assert.match(PANEL, /Replace syllabus/)
})

test('after an upload the evaluation state is re-read (eligibility or outdated result)', () => {
  assert.match(HOOK, /onUploadedRef\.current\(\)/)
  assert.match(source('../src/pages/AdminCourseEquivalencyReview.tsx'), /useCourseEquivalencySyllabi\(requestId, evaluation\.refresh\)/)
})

// Incomplete Exam student submission data layer (P3.1): form rules, PDF
// checks, safe names, UAE dates, error mapping, and the reserve -> upload ->
// submit order with fake calls. Run: npm test (no browser, Storage or database).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  EXAM_TYPES,
  FINAL_ONLY_MESSAGE,
  INCOMPLETE_EXAM_TYPE,
  IncompleteExamSubmitError,
  MAX_PROOF_FILE_BYTES,
  ProofUploadError,
  SAFE_PROOF_NAME,
  buildIncompleteExamEnrollments,
  checkProofFile,
  checkProofSelection,
  isExamType,
  isLateSubmission,
  missedExamDateError,
  missedExamTimeError,
  proofNoteError,
  proofPath,
  reasonError,
  safeProofFileName,
  submitErrorCode,
  toUploadReservation,
  uaeToday,
  uploadErrorCode,
  validateIncompleteExamForm,
  workingDaysBetween,
  type IncompleteExamForm,
} from '../src/utils/incompleteExamSubmission.ts'
import {
  RESERVATION_MARGIN_MS,
  newProofEntry,
  readyToSubmit,
  runIncompleteExamSubmission,
  submissionBlocker,
  type ProofEntry,
  type SubmissionDeps,
  type UploadReservation,
} from '../src/utils/incompleteExamSubmissionFlow.ts'

const SERVICE = readFileSync(new URL('../src/services/incompleteExamSubmission.ts', import.meta.url), 'utf8')

const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])   // %PDF-1.7
const pdf = (name = 'report.pdf', size = 1000) => ({ name, type: 'application/pdf', size })

const FORM: IncompleteExamForm = {
  courseId: 'CS101', sectionId: '1', term: '202601', examType: 'Final',
  missedExamDate: '2026-11-05', missedExamTime: '09:00',
  reason: 'I was admitted to hospital on the exam day.', proofNote: '',
}
const NOW = Date.parse('2026-11-08T08:00:00Z')

// ---------------------------------------------------------------------------
// Dates

test('uaeToday uses the UAE date (UTC+4), not the browser or UTC date', () => {
  assert.equal(uaeToday(new Date('2026-11-07T19:59:00Z')), '2026-11-07')
  assert.equal(uaeToday(new Date('2026-11-07T20:00:00Z')), '2026-11-08')
})

test('working days are counted like the agent: after the exam, Friday and Saturday excluded', () => {
  // 2026-11-05 is a Thursday.
  assert.equal(workingDaysBetween('2026-11-05', '2026-11-05'), 0)
  assert.equal(workingDaysBetween('2026-11-05', '2026-11-08'), 1)   // Fri, Sat skipped; Sun
  assert.equal(workingDaysBetween('2026-11-05', '2026-11-11'), 4)
  assert.equal(workingDaysBetween('2026-11-05', '2026-11-12'), 5)
  assert.equal(workingDaysBetween('2026-11-10', '2026-11-05'), 0)
  assert.equal(workingDaysBetween('2026-02-30', '2026-03-01'), null)
  assert.equal(isLateSubmission('2026-11-05', '2026-11-11'), false)
  assert.equal(isLateSubmission('2026-11-05', '2026-11-12'), true)
})

// ---------------------------------------------------------------------------
// Fields (the database's rules)

test('field rules match the database', () => {
  assert.ok(reasonError('   '))
  assert.ok(reasonError('x'.repeat(19)))
  assert.equal(reasonError(`  ${'x'.repeat(20)}  `), null)
  assert.equal(reasonError('x'.repeat(1000)), null)
  assert.ok(reasonError('x'.repeat(1001)))
  assert.equal(proofNoteError(''), null)
  assert.equal(proofNoteError('p'.repeat(500)), null)
  assert.ok(proofNoteError('p'.repeat(501)))
  assert.ok(missedExamDateError('', '2026-11-08'))
  assert.ok(missedExamDateError('2026-13-01', '2026-11-08'))
  assert.ok(missedExamDateError('2026-11-09', '2026-11-08'))
  assert.equal(missedExamDateError('2026-11-08', '2026-11-08'), null)
  assert.equal(missedExamDateError('2026-09-01', '2026-11-08'), null)   // late is allowed
  assert.equal(missedExamTimeError('09:30'), null)
  assert.equal(missedExamTimeError('09:30:00'), null)
  assert.ok(missedExamTimeError('25:00'))
  assert.ok(missedExamTimeError(''))
})

test('the whole form: valid, and each missing field reported', () => {
  assert.deepEqual(validateIncompleteExamForm(FORM, '2026-11-08'), {})
  const errors = validateIncompleteExamForm(
    { ...FORM, courseId: '', examType: 'Quiz' as never, missedExamTime: '', reason: 'short', proofNote: 'p'.repeat(501) },
    '2026-11-08',
  )
  assert.deepEqual(Object.keys(errors).sort(), ['examType', 'missedExamTime', 'proofNote', 'reason', 'section'])
})

test('Incomplete Exam is for final exams only: Midterm is never accepted', () => {
  assert.deepEqual([...EXAM_TYPES], ['Final'])
  assert.equal(INCOMPLETE_EXAM_TYPE, 'Final')
  assert.equal(isExamType('Final'), true)
  for (const value of ['Midterm', 'midterm', 'final', ' Final', 'Quiz', '', null, undefined]) {
    assert.equal(isExamType(value), false, String(value))
  }
  const errors = validateIncompleteExamForm({ ...FORM, examType: 'Midterm' as never }, '2026-11-08')
  assert.equal(errors.examType, FINAL_ONLY_MESSAGE)
  assert.match(FINAL_ONLY_MESSAGE, /final exams only/)
  assert.equal(new IncompleteExamSubmitError('invalid_exam_type').message, FINAL_ONLY_MESSAGE)
})

// ---------------------------------------------------------------------------
// PDF checks

test('a PDF must have a .pdf name, the PDF MIME type, 1 byte-10 MB and the %PDF- signature', () => {
  assert.equal(checkProofFile(pdf(), PDF_HEAD), null)
  assert.equal(checkProofFile(pdf('REPORT.PDF'), PDF_HEAD), null)
  assert.equal(checkProofFile(pdf('a.pdf', MAX_PROOF_FILE_BYTES), PDF_HEAD), null)
  assert.equal(checkProofFile(pdf('scan.png'), PDF_HEAD), 'not_pdf_name')
  assert.equal(checkProofFile({ ...pdf(), type: 'image/png' }, PDF_HEAD), 'not_pdf_type')
  assert.equal(checkProofFile({ ...pdf(), type: '' }, PDF_HEAD), 'not_pdf_type')
  assert.equal(checkProofFile(pdf('a.pdf', 0), PDF_HEAD), 'empty_file')
  assert.equal(checkProofFile(pdf('a.pdf', MAX_PROOF_FILE_BYTES + 1), PDF_HEAD), 'file_too_large')
  assert.equal(checkProofFile(pdf(), new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c])), 'not_pdf_content')   // <html
  assert.equal(checkProofFile(pdf(), new Uint8Array([0x25, 0x50])), 'not_pdf_content')
})

test('a selection allows at most 5 files, 18 MB together, and no file twice', () => {
  const mb = 1024 * 1024
  assert.equal(checkProofSelection([]), null)
  assert.equal(checkProofSelection([1, 2, 3, 4, 5].map((i) => pdf(`f${i}.pdf`, 3 * mb))), null)
  assert.equal(checkProofSelection([1, 2, 3, 4, 5, 6].map((i) => pdf(`f${i}.pdf`))), 'too_many_files')
  assert.equal(checkProofSelection([pdf('a.pdf', 9.5 * mb), pdf('b.pdf', 9.5 * mb)]), 'total_too_large')
  assert.equal(checkProofSelection([pdf('a.pdf', 18 * mb)]), null)
  assert.equal(checkProofSelection([{ ...pdf(), lastModified: 1 }, { ...pdf(), lastModified: 1 }]), 'duplicate_file')
})

// ---------------------------------------------------------------------------
// Safe names

test('storage names are <8 hex>-<safe name>.pdf and always match the database rule', () => {
  assert.equal(safeProofFileName('Médical Report (1).PDF', 'a1b2c3d4'), 'a1b2c3d4-Medical-Report-1.pdf')
  assert.equal(safeProofFileName('../../etc/passwd.pdf', 'a1b2c3d4'), 'a1b2c3d4-etc-passwd.pdf')
  assert.equal(safeProofFileName('.pdf', 'a1b2c3d4'), 'a1b2c3d4-document.pdf')
  assert.equal(safeProofFileName('تقرير طبي.pdf', 'a1b2c3d4'), 'a1b2c3d4-document.pdf')
  const long = safeProofFileName(`${'x'.repeat(300)}.pdf`, 'a1b2c3d4')
  for (const name of ['Médical Report (1).PDF', '../../etc/passwd.pdf', 'a\u0000b.pdf', ' -._weird_-. .pdf', `${'x'.repeat(300)}.pdf`]) {
    const safe = safeProofFileName(name, '0f0f0f0f')
    assert.match(safe, SAFE_PROOF_NAME)
    assert.ok(!safe.includes('/') && !safe.includes('\\'))
  }
  assert.ok(long.length <= 113)
  assert.throws(() => safeProofFileName('a.pdf', 'XYZ'))
  assert.equal(proofPath('STUD_INCRQ_INC2_000123', 'a1b2c3d4-x.pdf'), 'STUD_INCRQ_INC2_000123/a1b2c3d4-x.pdf')
})

// ---------------------------------------------------------------------------
// Error mapping

test('database refusals map to their codes; session problems to signed_out', () => {
  for (const code of ['duplicate_request', 'not_enrolled', 'upload_session_expired', 'proof_files_too_large',
                      'too_many_upload_sessions', 'missed_exam_date_in_future'] as const) {
    assert.equal(submitErrorCode({ message: code }), code)
    assert.ok(new IncompleteExamSubmitError(code).message.length > 10)
  }
  assert.equal(submitErrorCode({ code: 'PGRST301', message: 'JWT expired' }), 'signed_out')
  assert.equal(submitErrorCode({ message: 'permission denied for function submit_incomplete_exam_request' }), 'signed_out')
  assert.equal(submitErrorCode({ message: 'signed_out' }), 'unknown')
  assert.equal(submitErrorCode({ message: 'something else' }), 'unknown')
  assert.equal(submitErrorCode(null), 'unknown')
})

test('Storage upload errors map to their kinds', () => {
  assert.equal(uploadErrorCode({ statusCode: '409', message: 'The resource already exists' }), 'already_exists')
  assert.equal(uploadErrorCode({ statusCode: '413', message: 'Payload too large' }), 'file_too_large')
  assert.equal(uploadErrorCode({ status: 415, message: 'mime type image/png is not supported' }), 'file_type_refused')
  assert.equal(uploadErrorCode({ statusCode: '403', message: 'new row violates row-level security policy' }), 'upload_refused')
  assert.equal(uploadErrorCode({ statusCode: '400', message: 'new row violates row-level security policy' }), 'upload_refused')
  assert.equal(uploadErrorCode({ message: 'Failed to fetch' }), 'upload_failed')
  assert.equal(uploadErrorCode(undefined), 'upload_failed')
})

test('the reservation answer is checked', () => {
  assert.deepEqual(toUploadReservation({ upload_id: 'STUD_INCRQ_INC2_000123', expires_at: '2026-11-08T08:30:00Z' }),
    { uploadId: 'STUD_INCRQ_INC2_000123', expiresAt: '2026-11-08T08:30:00Z' })
  assert.equal(toUploadReservation({ upload_id: '../x', expires_at: '2026-11-08T08:30:00Z' }), null)
  assert.equal(toUploadReservation({ upload_id: 'STUD_INCRQ_INC2_000123', expires_at: 'never' }), null)
  assert.equal(toUploadReservation(null), null)
})

// ---------------------------------------------------------------------------
// Enrolments

test('enrolments: only the term, one per section, open exams marked, course order', () => {
  const list = buildIncompleteExamEnrollments(
    [
      { Course_ID: 'MATH201', Section_ID: 2, Term: 202601 },
      { Course_ID: 'CS101', Section_ID: '1', Term: '202601' },
      { Course_ID: 'CS101', Section_ID: '1', Term: '202601' },
      { Course_ID: 'BIO100', Section_ID: '3', Term: 202502 },
    ],
    [
      { Course_ID: 'CS101', Section_ID: '1', Term: 202601, Exam_Type: 'Final' },
      { Course_ID: 'CS101', Section_ID: '1', Term: 202601, Exam_Type: 'Quiz' },
      // An older Midterm request does not count (and does not block the Final).
      { Course_ID: 'MATH201', Section_ID: '2', Term: 202601, Exam_Type: 'Midterm' },
    ],
    new Map([['CS101', 'Programming I']]),
    '202601',
  )
  assert.deepEqual(list.map((e) => [e.courseId, e.sectionId, e.term, e.courseName, e.openExamTypes]), [
    ['CS101', '1', '202601', 'Programming I', ['Final']],
    ['MATH201', '2', '202601', '', []],
  ])
})

// ---------------------------------------------------------------------------
// The reserve -> upload -> submit order

type Fake = { name: string }

function fakeDeps(options: {
  failUpload?: (entry: ProofEntry<Fake>) => ProofUploadError | null
  submitError?: IncompleteExamSubmitError
  reserveError?: IncompleteExamSubmitError
} = {}) {
  const calls: string[] = []
  let reserved = 0
  let submitArgs: { uploadId: string | null; paths: string[] } | null = null
  const deps: SubmissionDeps<Fake> = {
    now: () => NOW,
    reserve: async () => {
      calls.push('reserve')
      if (options.reserveError) throw options.reserveError
      reserved += 1
      return { uploadId: `STUD_INCRQ_INC2_00010${reserved}`, expiresAt: '2026-11-08T08:30:00Z' }
    },
    upload: async (uploadId, entry) => {
      calls.push(`upload:${entry.file.name}`)
      const failure = options.failUpload?.(entry)
      if (failure) throw failure
      return proofPath(uploadId, entry.fileName)
    },
    submit: async (_form, uploadId, paths) => {
      calls.push('submit')
      submitArgs = { uploadId, paths }
      if (options.submitError) throw options.submitError
      return uploadId ?? 'STUD_INCRQ_INC2_000200'
    },
  }
  return { deps, calls, submitArgs: () => submitArgs }
}

const entry = (name: string, hex = '0000000a') => newProofEntry<Fake>(`id-${name}`, { name }, safeProofFileName(name, hex))

test('no PDFs: submit once with no upload ID and no paths; nothing reserved or uploaded', async () => {
  const fake = fakeDeps()
  const outcome = await runIncompleteExamSubmission(fake.deps, { form: FORM, entries: [], reservation: null })
  assert.equal(outcome.kind, 'submitted')
  assert.deepEqual(fake.calls, ['submit'])
  assert.deepEqual(fake.submitArgs(), { uploadId: null, paths: [] })
})

test('with PDFs: reserve once, upload each in order, then submit the paths in the same order', async () => {
  const fake = fakeDeps()
  const input = [entry('b.pdf', '0000000b'), entry('a.pdf', '0000000a')]
  const snapshot = JSON.stringify(input)
  const outcome = await runIncompleteExamSubmission(fake.deps, { form: FORM, entries: input, reservation: null })
  assert.equal(outcome.kind, 'submitted')
  assert.deepEqual(fake.calls, ['reserve', 'upload:b.pdf', 'upload:a.pdf', 'submit'])
  assert.deepEqual(fake.submitArgs(), {
    uploadId: 'STUD_INCRQ_INC2_000101',
    paths: ['STUD_INCRQ_INC2_000101/0000000b-b.pdf', 'STUD_INCRQ_INC2_000101/0000000a-a.pdf'],
  })
  assert.equal(outcome.reservation, null)
  assert.equal(JSON.stringify(input), snapshot, 'the entries passed in are not changed')
})

test('a failed upload: submit is NOT called, and the failed file blocks every retry until it is replaced', async () => {
  const fake = fakeDeps({ failUpload: (e) => (e.file.name === 'b.pdf' ? new ProofUploadError('upload_failed') : null) })
  const first = await runIncompleteExamSubmission(fake.deps, {
    form: FORM, entries: [entry('a.pdf', '0000000a'), entry('b.pdf', '0000000b')], reservation: null,
  })
  assert.equal(first.kind, 'uploads_failed')
  assert.ok(!fake.calls.includes('submit'))
  assert.deepEqual(first.entries.map((e) => [e.status, e.error]), [['uploaded', null], ['failed', 'upload_failed']])
  assert.equal(readyToSubmit(first.entries, first.reservation), false)
  assert.equal(submissionBlocker(first.entries), 'failed_files')

  // Trying again with the failed file still in the list: nothing is called at all.
  fake.calls.length = 0
  const again = await runIncompleteExamSubmission(fake.deps, {
    form: FORM, entries: first.entries, reservation: first.reservation,
  })
  assert.equal(again.kind, 'uploads_failed')
  assert.deepEqual(fake.calls, [])
})

test('the student replaces a failed file: only the new file is uploaded', async () => {
  const fake = fakeDeps({ failUpload: (e) => (e.file.name === 'bad.pdf' ? new ProofUploadError('file_too_large') : null) })
  const first = await runIncompleteExamSubmission(fake.deps, {
    form: FORM, entries: [entry('a.pdf', '0000000a'), entry('bad.pdf', '0000000c')], reservation: null,
  })
  assert.equal(first.kind, 'uploads_failed')
  fake.calls.length = 0
  const replaced = [first.entries[0], entry('good.pdf', '0000000d')]
  const second = await runIncompleteExamSubmission(fake.deps, { form: FORM, entries: replaced, reservation: first.reservation })
  assert.equal(second.kind, 'submitted')
  assert.deepEqual(fake.calls, ['upload:good.pdf', 'submit'])
})

test('a 409 "already exists" is always a failure: an existing object is never accepted', async () => {
  const fake = fakeDeps({ failUpload: (e) => (e.file.name === 'a.pdf' ? new ProofUploadError('already_exists') : null) })
  const outcome = await runIncompleteExamSubmission(fake.deps, {
    form: FORM, entries: [entry('a.pdf', '0000000a'), entry('b.pdf', '0000000b')], reservation: null,
  })
  assert.equal(outcome.kind, 'uploads_failed')
  assert.deepEqual(outcome.entries.map((e) => [e.status, e.path, e.error]),
    [['failed', null, 'already_exists'], ['uploaded', 'STUD_INCRQ_INC2_000101/0000000b-b.pdf', null]])
  assert.ok(!fake.calls.includes('submit'))
  assert.match(new ProofUploadError('already_exists').message, /Remove it and select it again/)

  // The conflicting file blocks every retry until it is removed and reselected.
  fake.calls.length = 0
  const again = await runIncompleteExamSubmission(fake.deps, { form: FORM, entries: outcome.entries, reservation: outcome.reservation })
  assert.equal(again.kind, 'uploads_failed')
  assert.deepEqual(fake.calls, [])

  // Reselected (a new entry with a new random name): only it is uploaded.
  const reselected = [entry('a.pdf', '0000000c'), outcome.entries[1]]
  const ok = fakeDeps()
  const done = await runIncompleteExamSubmission(ok.deps, { form: FORM, entries: reselected, reservation: outcome.reservation })
  assert.equal(done.kind, 'submitted')
  assert.deepEqual(ok.calls, ['upload:a.pdf', 'submit'])
})

test('an upload already running blocks another attempt', () => {
  assert.equal(submissionBlocker([{ ...entry('a.pdf'), status: 'uploading' }]), 'uploading')
  assert.equal(submissionBlocker([entry('a.pdf'), { ...entry('b.pdf'), status: 'uploaded' }]), null)
  assert.equal(submissionBlocker([]), null)
})

test('an unexpected upload error is a failure, never a success', async () => {
  const fake = fakeDeps({ failUpload: () => new Error('boom') as unknown as ProofUploadError })
  const outcome = await runIncompleteExamSubmission(fake.deps, { form: FORM, entries: [entry('a.pdf')], reservation: null })
  assert.equal(outcome.kind, 'uploads_failed')
  assert.deepEqual(outcome.entries.map((e) => e.error), ['upload_failed'])
  assert.ok(!fake.calls.includes('submit'))
})

test('submit is called only after every file has finished uploading', async () => {
  const fake = fakeDeps()
  const published: string[][] = []
  const deps: SubmissionDeps<Fake> = {
    ...fake.deps,
    submit: async (form, uploadId, paths) => {
      assert.ok(published.length > 0 && published.at(-1)!.every((s) => s === 'uploaded'))
      return fake.deps.submit(form, uploadId, paths)
    },
  }
  const outcome = await runIncompleteExamSubmission(deps, {
    form: FORM, entries: [entry('a.pdf', '0000000a'), entry('b.pdf', '0000000b')], reservation: null,
    onEntries: (list) => published.push(list.map((e) => e.status)),
  })
  assert.equal(outcome.kind, 'submitted')
  assert.ok(published.some((s) => s.includes('uploading')))
})

test('a reservation for another exam, or about to expire, is replaced and every file uploaded again', async () => {
  const uploaded = [{ ...entry('a.pdf'), status: 'uploaded' as const, path: 'STUD_INCRQ_INC2_000099/0000000a-a.pdf' }]
  const other: UploadReservation = {
    uploadId: 'STUD_INCRQ_INC2_000099', expiresAt: '2026-11-08T08:30:00Z',
    examKey: JSON.stringify(['CS101', '2', '202601', 'Final']),   // another section's final
  }
  const fake = fakeDeps()
  const outcome = await runIncompleteExamSubmission(fake.deps, { form: FORM, entries: uploaded, reservation: other })
  assert.equal(outcome.kind, 'submitted')
  assert.deepEqual(fake.calls, ['reserve', 'upload:a.pdf', 'submit'])

  const expiring: UploadReservation = {
    uploadId: 'STUD_INCRQ_INC2_000099', examKey: JSON.stringify(['CS101', '1', '202601', 'Final']),
    expiresAt: new Date(NOW + RESERVATION_MARGIN_MS - 1000).toISOString(),
  }
  const fake2 = fakeDeps()
  await runIncompleteExamSubmission(fake2.deps, { form: FORM, entries: uploaded, reservation: expiring })
  assert.deepEqual(fake2.calls, ['reserve', 'upload:a.pdf', 'submit'])
})

test('a still-valid reservation for the same exam is reused (no new reservation)', async () => {
  const same: UploadReservation = {
    uploadId: 'STUD_INCRQ_INC2_000099', expiresAt: '2026-11-08T08:30:00Z',
    examKey: JSON.stringify(['CS101', '1', '202601', 'Final']),
  }
  const fake = fakeDeps()
  await runIncompleteExamSubmission(fake.deps, { form: FORM, entries: [entry('a.pdf')], reservation: same })
  assert.deepEqual(fake.calls, ['upload:a.pdf', 'submit'])
  assert.equal(fake.submitArgs()?.uploadId, 'STUD_INCRQ_INC2_000099')
})

test('an expired / used reservation refused by the database is discarded; files will be uploaded again', async () => {
  const fake = fakeDeps({ submitError: new IncompleteExamSubmitError('upload_session_expired') })
  const outcome = await runIncompleteExamSubmission(fake.deps, { form: FORM, entries: [entry('a.pdf')], reservation: null })
  assert.equal(outcome.kind, 'refused')
  assert.equal(outcome.kind === 'refused' && outcome.code, 'upload_session_expired')
  assert.equal(outcome.reservation, null)
  assert.deepEqual(outcome.entries.map((e) => e.status), ['pending'])
})

test('a form refusal keeps the reservation and the uploads, so a retry uploads nothing again', async () => {
  const fake = fakeDeps({ submitError: new IncompleteExamSubmitError('missed_exam_date_in_future') })
  const first = await runIncompleteExamSubmission(fake.deps, { form: FORM, entries: [entry('a.pdf')], reservation: null })
  assert.equal(first.kind, 'refused')
  assert.notEqual(first.reservation, null)
  assert.deepEqual(first.entries.map((e) => e.status), ['uploaded'])

  const ok = fakeDeps()
  const second = await runIncompleteExamSubmission(ok.deps, { form: FORM, entries: first.entries, reservation: first.reservation })
  assert.equal(second.kind, 'submitted')
  assert.deepEqual(ok.calls, ['submit'])
})

test('a refused reservation (e.g. daily limit) uploads and submits nothing', async () => {
  const fake = fakeDeps({ reserveError: new IncompleteExamSubmitError('too_many_upload_sessions') })
  const outcome = await runIncompleteExamSubmission(fake.deps, { form: FORM, entries: [entry('a.pdf')], reservation: null })
  assert.equal(outcome.kind === 'refused' && outcome.code, 'too_many_upload_sessions')
  assert.deepEqual(fake.calls, ['reserve'])
})

test('more than 5 files are refused before any call', async () => {
  const fake = fakeDeps()
  const six = [1, 2, 3, 4, 5, 6].map((i) => entry(`f${i}.pdf`, `0000000${i}`))
  const outcome = await runIncompleteExamSubmission(fake.deps, { form: FORM, entries: six, reservation: null })
  assert.equal(outcome.kind === 'refused' && outcome.code, 'too_many_proof_files')
  assert.deepEqual(fake.calls, [])
})

// ---------------------------------------------------------------------------
// The Supabase service (source checks)

test('the service uses the signed-in client, own enrolments of the term, and the installed functions', () => {
  assert.match(SERVICE, /import \{ supabase \} from '\.\/supabase'/)
  assert.doesNotMatch(SERVICE, /service_role|SERVICE_ROLE|createClient/)
  assert.match(SERVICE, /\.from\('Takes'\)[\s\S]*?\.eq\('Student_ID', studentId\)[\s\S]*?\.eq\('Term', CURRENT_TERM\)/)
  assert.match(SERVICE, /\.rpc\('reserve_incomplete_exam_upload'/)
  assert.match(SERVICE, /\.rpc\('submit_incomplete_exam_request'/)
  for (const param of ['p_course_id', 'p_section_id', 'p_term', 'p_exam_type', 'p_missed_exam_date',
                       'p_missed_exam_time', 'p_reason', 'p_proof', 'p_upload_id', 'p_proof_paths']) {
    assert.ok(SERVICE.includes(`${param}:`), `submit passes ${param}`)
  }
})

test('uploads are standard, never overwrite, and nothing is ever replaced or deleted', () => {
  assert.match(SERVICE, /\.storage\.from\(PROOF_BUCKET\)\.upload\(path, entry\.file, \{\s*upsert: false,/)
  assert.match(SERVICE, /contentType: 'application\/pdf'/)
  assert.doesNotMatch(SERVICE, /upsert: true|\.remove\(|\.move\(|\.update\(|uploadToSignedUrl|createSignedUploadUrl|\btus\b/i)
  // Checked again right before sending.
  assert.match(SERVICE, /checkSelectedProof\(entry\.file\)\) !== null\) throw new ProofUploadError\('invalid_file'\)/)
  // A 409 is never "confirmed" from an existing object.
  assert.doesNotMatch(SERVICE, /\.list\(|confirm/)
  assert.match(SERVICE, /\{ reserve: reserveUpload, upload: uploadProof, submit: submitRequest, now: \(\) => Date\.now\(\) \}/)
})

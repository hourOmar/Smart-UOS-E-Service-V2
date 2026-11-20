// Incomplete Exam student submission page (P3.2): route, catalog entry, and
// the page's safety rules, checked from the source (no browser tooling in
// this project), plus the small display helpers. Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { academicRequestTypes, futureServices } from '../src/data/academicRequests.ts'
import { PROOF_STATUS_LABELS, formatFileSize } from '../src/utils/incompleteExamSubmission.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const PAGE = read('../src/pages/IncompleteExamForm.tsx')
const FILES = read('../src/components/incompleteExam/ProofFilesField.tsx')
const PICKER = read('../src/components/incompleteExam/EnrollmentPicker.tsx')
const HOOK = read('../src/hooks/useIncompleteExamEnrollments.ts')
const APP = read('../src/App.tsx')

test('the student route exists and is protected for students', () => {
  assert.match(APP, /import IncompleteExamForm from '\.\/pages\/IncompleteExamForm'/)
  assert.match(APP, /path="\/student\/services\/incomplete-exam\/new"\s+element=\{\s+<ProtectedRoute requiredRole="student">\s+<IncompleteExamForm \/>/)
})

test('the catalog entry is enabled with real details', () => {
  const entry = academicRequestTypes.find((t) => t.id === 'incomplete-exam')
  assert.ok(entry)
  assert.equal(entry.startPath, '/student/services/incomplete-exam/new')
  assert.ok(entry.details.description.length > 50)
  assert.ok(entry.details.steps.length >= 4)
  assert.ok(entry.details.requiredDocuments.some((d) => /optional/i.test(d)))
  // Documents are optional ("You may provide") and limited to five PDF files.
  assert.match(entry.details.supportingDocuments, /^You may provide supporting evidence/)
  assert.match(entry.details.supportingDocuments, /up to five PDF files\.$/)
})

test('the page only uses the P3.1 data layer (no direct Supabase, Storage or agent calls)', () => {
  assert.match(PAGE, /submitIncompleteExam\(\{ form, entries, reservation, onEntries: setEntries \}\)/)
  assert.doesNotMatch(PAGE, /from '\.\.\/services\/supabase'|supabase\.|\.storage|\.rpc\(/)
  // No AI evaluation can start from here: none of the evaluation code is used.
  assert.doesNotMatch(PAGE + FILES + PICKER + HOOK,
    /IncompleteExamEvaluation|incompleteExamReview|callBackend|backendApi|\/api\/staff/)
  assert.match(HOOK, /fetchMyIncompleteExamEnrollments\(\)/)
})

test('duplicate submissions are prevented and the form is locked while submitting', () => {
  // The guard is checked first and set before anything is sent.
  assert.match(PAGE, /const handleSubmit = async[\s\S]*?event\.preventDefault\(\)\s+if \(submittingRef\.current\) return/)
  assert.match(PAGE, /submittingRef\.current = true\s+setSubmitting\(true\)\s+try \{\s+const outcome = await submitIncompleteExam/)
  assert.match(PAGE, /finally \{\s+submittingRef\.current = false\s+setSubmitting\(false\)/)
  // Every field, the file picker and both buttons sit in one disabled fieldset.
  assert.match(PAGE, /<fieldset className="rc-page__columns ie-fieldset" disabled=\{submitting\}>/)
  assert.match(PAGE, /locked=\{submitting\}/)
  // No file changes while submitting.
  assert.match(PAGE, /const addFiles = async[\s\S]*?if \(submittingRef\.current \|\| chosen\.length === 0\) return/)
  assert.match(PAGE, /const removeFile = \(id: string\) => \{\s+if \(submittingRef\.current\) return/)
  assert.match(FILES, /disabled=\{locked \|\| full\}/)
  assert.match(FILES, /onClick=\{\(\) => onRemove\(entry\.id\)\}\s+disabled=\{locked\}/)
})

test('a failed file blocks submission until it is removed and selected again', () => {
  assert.match(PAGE, /if \(submissionBlocker\(entries\) === 'failed_files'\) \{\s+setSubmitError\(FAILED_FILES_MESSAGE\)\s+return/)
  assert.match(PAGE, /outcome\.kind === 'uploads_failed'\) \{\s+setSubmitError\(FAILED_FILES_MESSAGE\)/)
  assert.match(PAGE, /Remove each file marked “Not uploaded”, select it again, then submit\./)
  assert.match(FILES, /entry\.status === 'failed' && entry\.error/)
  assert.match(FILES, /PROOF_UPLOAD_ERROR_MESSAGES\[entry\.error\]/)
})

test('PDFs are optional, checked when chosen, and limited to 5', () => {
  assert.match(FILES, /accept="\.pdf,application\/pdf"\s+multiple/)
  assert.match(FILES, /Supporting documents \(optional\)/)
  assert.match(PAGE, /const problem = await checkSelectedProof\(file\)/)
  assert.match(PAGE, /checkProofSelection\(\[\.\.\.entries, \.\.\.accepted\]\.map\(\(e\) => e\.file\)\.concat\(file\)\)/)
  assert.match(PAGE, /accepted\.push\(proofEntryFor\(file\)\)/)
  assert.match(FILES, /const full = entries\.length >= MAX_PROOF_FILES/)
})

test('late dates warn without blocking; future dates are refused; the date uses the UAE day', () => {
  assert.match(PAGE, /const \[today\] = useState\(uaeToday\)/)
  assert.match(PAGE, /max=\{today\}/)
  assert.match(PAGE, /isLateSubmission\(missedExamDate, today\)/)
  assert.match(PAGE, /\{late && \(\s+<p id="ie-late" className="ie-warning" role="note">/)
  assert.match(PAGE, /You can still submit/)
  // The warning is not part of the validation that blocks submission.
  assert.doesNotMatch(PAGE, /if \([^)]*late[^)]*\)\s*\{?\s*(return|setSubmitError)/)
})

test('the student enrolments come only from the hook, with names; an exam already requested is flagged', () => {
  assert.match(PAGE, /useIncompleteExamEnrollments\(\)/)
  assert.match(PICKER, /enrollment\.courseName \|\| enrollment\.courseId/)
  assert.match(PICKER, /Request in progress:/)
  assert.match(PAGE, /selected\.openExamTypes\.includes\(examType\)/)
})

test('success shows the Request ID and replaces the form (no more file changes)', () => {
  assert.match(PAGE, /\{submitted \? \(\s+<section className="rc-done"/)
  assert.match(PAGE, /<span className="rc-done__id">\{submitted\.id\}<\/span>/)
  assert.match(PAGE, /navigate\(requestDetailsPath\(submitted\.id\)\)/)
  // The form (and its file picker) is only rendered when not submitted.
  assert.ok(PAGE.indexOf('{submitted ? (') < PAGE.indexOf('<form onSubmit={handleSubmit}'))
})

test('final exams only: no exam type section on the form, Final always sent', () => {
  assert.doesNotMatch(PAGE, /midterm/i)
  // No exam type field, label or note at all.
  assert.doesNotMatch(PAGE, /Exam type|ie-exam|ie-fixed|Final Exam<|FINAL_ONLY_MESSAGE|type="radio"|setExamType|EXAM_TYPES/)
  // The details panel starts with the missed exam date and time.
  assert.match(PAGE, /Exam and Reason\s*<\/h2>\s*<\/div>\s*<div className="ie-row">/)
  // Final is still sent with every submission.
  assert.match(PAGE, /const examType: ExamType = INCOMPLETE_EXAM_TYPE/)
  assert.match(PAGE, /const form: IncompleteExamFormValues = \{[\s\S]*?\n\s+examType,\n/)
  // "Already requested" is still shown, on the course section.
  assert.match(PAGE, /error=\{shown\.section \?\? shown\.examType\}/)
  assert.match(PAGE, /Request an incomplete for a final exam you were unable to attend\./)
})

test('the catalog describes final exams only and points midterms to their own service', () => {
  const entry = academicRequestTypes.find((t) => t.id === 'incomplete-exam')!
  const text = [entry.description, entry.keywords, entry.details.description, ...entry.details.steps,
                ...entry.details.checklist, ...entry.details.requiredDocuments].join(' ')
  assert.doesNotMatch(text, /midterm/i)
  assert.ok(entry.details.notes.some((n) => /final exams only\. Midterm exams have a separate request service\./.test(n)))
  // The separate midterm service is still listed.
  assert.ok(futureServices.some((s) => s.name === 'Midterm Makeup Exam'))
})

test('leaving during an upload asks first', () => {
  assert.match(PAGE, /if \(!submitting\) return\s+const warn[\s\S]*?addEventListener\('beforeunload', warn\)/)
})

test('no evidence description on the form; an empty one is still sent, documents unchanged', () => {
  // The field (label, help, textarea, counter) is gone.
  assert.ok(!PAGE.includes('Description of your evidence'))
  assert.doesNotMatch(PAGE, /id="ie-proof"|ie-proof-help|ie-proof-count|setProofNote|PROOF_NOTE_MAX_LENGTH/)
  // The submission keeps its shape: '' is sent as p_proof, which the RPC stores
  // as '' (Incomplete_Exam.Proof is NOT NULL), and '' always passes validation.
  assert.match(PAGE, /const proofNote = ''\r?\n/)
  assert.equal((PAGE.match(/^\s+proofNote,\r?$/gm) ?? []).length, 2)
  const SERVICE = read('../src/services/incompleteExamSubmission.ts')
  assert.match(SERVICE, /p_proof: form\.proofNote,/)
  // Supporting documents are unchanged.
  assert.match(PAGE, /<ProofFilesField\s+entries=\{entries\}/)
  // Earlier requests still show their saved description to the student
  // (only when there is one: tests/studentProofDocuments.test.ts).
  const DETAILS = read('../src/services/studentRequests.ts')
  assert.match(DETAILS, /\.\.\.evidenceDescriptionFields\(row\.Proof\),/)
})

test('supporting documents: a compact upload area whose button opens the same file picker', () => {
  const CSS = read('../src/pages/IncompleteExamForm.css')
  // Heading, icon, title, the button (the label of the hidden file input), limits, count.
  assert.match(FILES, /Supporting documents \(optional\)/)
  assert.match(FILES, /<div className="ie-drop" data-disabled=\{locked \|\| full \|\| undefined\}>/)
  assert.match(FILES, /Add supporting documents/)
  assert.match(FILES, /<label htmlFor="ie-files-input" className="ie-drop__button" aria-disabled=\{locked \|\| full \|\| undefined\}>\s+Choose PDF files/)
  assert.match(FILES, /PDF only · Max \{MAX_PROOF_FILES\} files · 10 MB each · 18 MB total/)
  assert.match(FILES, /\{entries\.length\} of \{MAX_PROOF_FILES\} files selected/)
  // The warning sits below the area.
  const area = FILES.indexOf('<div className="ie-drop"')
  const note = FILES.indexOf('Documents cannot be added, replaced, or removed after submission.')
  assert.ok(area > -1 && note > area)
  // Same input, handlers and limits; chosen files listed with size, status and Remove.
  assert.match(FILES, /id="ie-files-input"\s+type="file"\s+accept="\.pdf,application\/pdf"\s+multiple\s+className="student-visually-hidden"\s+onChange=\{onAdd\}\s+disabled=\{locked \|\| full\}/)
  assert.match(FILES, /\{formatFileSize\(entry\.file\.size\)\} ·/)
  assert.match(FILES, /PROOF_STATUS_LABELS\[entry\.status\]/)
  assert.match(FILES, /aria-label=\{`Remove \$\{entry\.file\.name\}`\}/)
  // No drag and drop is implied or handled.
  assert.doesNotMatch(FILES, /onDrop|onDragOver|[Dd]rag (and|&) drop here/)
  // Compact: a dashed, light area with small padding, a small icon and button.
  assert.match(CSS, /\.ie-drop \{[^}]*padding: 18px 16px 16px;[^}]*border: 1\.5px dashed #b8c7bd;[^}]*border-radius: 10px;[^}]*background: #f8fbf9;/)
  assert.match(CSS, /\.ie-drop__icon \{[^}]*width: 34px;[^}]*height: 34px;/)
  assert.match(CSS, /\.ie-drop__button \{[^}]*padding: 7px 16px;[^}]*background: var\(--proto-green\);/)
  assert.doesNotMatch(CSS, /\.ie-files__picker|\.ie-files__add/)
})

test('display helpers', () => {
  assert.equal(formatFileSize(0), '1 KB')
  assert.equal(formatFileSize(340 * 1024), '340 KB')
  assert.equal(formatFileSize(1.25 * 1024 * 1024), '1.3 MB')
  assert.equal(formatFileSize(10 * 1024 * 1024), '10.0 MB')
  assert.equal(formatFileSize(-1), '')
  assert.deepEqual(Object.keys(PROOF_STATUS_LABELS).sort(), ['failed', 'pending', 'uploaded', 'uploading'])
  assert.equal(PROOF_STATUS_LABELS.failed, 'Not uploaded')
})

test('the explanation help text no longer asks for a minimum length', () => {
  assert.match(PAGE, /<span id="ie-reason-help" className="rc-field__help">\s+Explain what happened\.\s+<\/span>/)
  assert.doesNotMatch(PAGE, /at least 20 characters/)
  const CATALOG = read('../src/data/academicRequests.ts')
  const entry = CATALOG.slice(CATALOG.indexOf("id: 'incomplete-exam'"), CATALOG.indexOf("id: 'program-change'"))
  assert.match(entry, /'Prepare a clear reason for your request\.'/)
  assert.doesNotMatch(entry, /20 characters/)
})

test('Raise Capacity: the justification help text is the short version', () => {
  const FIELD = read('../src/components/raiseCapacity/JustificationField.tsx')
  assert.match(FIELD, /<span id="rc-justification-help" className="rc-field__help">\s+Explain why you need a seat in this section\.\s+<\/span>/)
  assert.doesNotMatch(FIELD, /graduation\s+plan or schedule conflicts/)
})

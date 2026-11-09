// Incomplete Exam supporting documents on the student's request details page
// (P3.3): friendly names, student-facing errors, and the read-only, own-
// session rules, checked from the source. Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { PROOF_ERROR_MESSAGES } from '../src/utils/incompleteExamRecord.ts'
import { STUDENT_DOCUMENT_ERROR_MESSAGES, displayProofName } from '../src/utils/incompleteExamSubmission.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const SERVICE = read('../src/services/studentRequests.ts')
const DOCS = read('../src/components/requests/StudentProofDocuments.tsx')
const PAGE = read('../src/pages/StudentRequestDetails.tsx')
const RID = 'STUD_INCRQ_INC2_000123'

test('friendly names drop the random prefix; other names are shown as stored', () => {
  assert.equal(displayProofName(RID, `${RID}/a1b2c3d4-Medical-Report-1.pdf`), 'Medical-Report-1.pdf')
  assert.equal(displayProofName(RID, `${RID}/a1b2c3d4-document.pdf`), 'document.pdf')
  assert.equal(displayProofName(RID, `${RID}/medical report.pdf`), 'medical report.pdf')   // older upload
  assert.equal(displayProofName(RID, `${RID}/A1B2C3D4-x.pdf`), 'A1B2C3D4-x.pdf')            // not our prefix
})

test('a path outside the request\'s own folder has no name (and is not opened)', () => {
  for (const path of ['STUD_INCRQ_INC2_000999/a.pdf', `${RID}/sub/a.pdf`, `${RID}/`, `../${RID}/a.pdf`, `${RID}/a\\b.pdf`]) {
    assert.equal(displayProofName(RID, path), null, path)
  }
})

test('every document error has a student-facing message (no staff wording)', () => {
  for (const reason of Object.keys(PROOF_ERROR_MESSAGES)) {
    assert.ok(STUDENT_DOCUMENT_ERROR_MESSAGES[reason], reason)
    assert.doesNotMatch(STUDENT_DOCUMENT_ERROR_MESSAGES[reason], /staff|proof file|agent/i)
  }
  assert.ok(STUDENT_DOCUMENT_ERROR_MESSAGES.blocked_tab)
})

test('the details service reads Proof_Files for Incomplete Exam only', () => {
  assert.match(SERVICE, /'Course_ID, Section_ID, Term, Exam_Type, Missed_Exam_Date, Missed_Exam_Time, Proof, Reason, Proof_Files'/)
  assert.match(SERVICE, /documents: textList\(row\.Proof_Files\)/)
  assert.match(SERVICE, /documents: row\.Request_Type === 'Incomplete Exam' \? \(details\.documents \?\? \[\]\) : null/)
  assert.match(SERVICE, /\{ label: 'Description of evidence', value: text\(row\.Proof\) \}/)
})

test('documents open only on click, with the student\'s own session, through the checked download', () => {
  assert.match(DOCS, /import \{ ProofDocumentError, openProofDocument \} from '\.\.\/\.\.\/services\/incompleteExamReview'/)
  assert.match(DOCS, /await openProofDocument\(requestId, path\)/)
  assert.match(DOCS, /onClick=\{\(\) => void handle\(path, shown, 'open'\)\}/)
  assert.match(DOCS, /onClick=\{\(\) => void handle\(path, shown, 'download'\)\}/)
  // The temporary local URLs are released when the page closes.
  assert.match(DOCS, /for \(const revoke of list\.splice\(0\)\) revoke\(\)/)
  // No direct Storage access, no other key, no public or signed links.
  assert.doesNotMatch(DOCS, /supabase|createSignedUrl|getPublicUrl|service_role/i)
})

test('the list is read-only and shows no AI evaluation details', () => {
  assert.doesNotMatch(DOCS, /type="file"|\.upload\(|\.remove\(|\.update\(|\.move\(|>\s*(Remove|Replace|Delete|Add)\b/)
  assert.doesNotMatch(DOCS, /outcome|PROOF_OUTCOME_LABELS|proofOutcomes|recommendation|incompleteExamEvaluation|EvaluationPanel/)
  assert.match(DOCS, /No supporting documents were submitted with this request\./)
  assert.match(DOCS, /Documents cannot be added, replaced or removed after submission\./)
})

test('the details page shows the documents for Incomplete Exam requests only', () => {
  assert.match(PAGE, /import StudentProofDocuments from '\.\.\/components\/requests\/StudentProofDocuments'/)
  assert.match(PAGE, /\{request\.type === INCOMPLETE_EXAM && request\.documents !== null && \(\s+<StudentProofDocuments requestId=\{request\.id\} paths=\{request\.documents\} \/>/)
})

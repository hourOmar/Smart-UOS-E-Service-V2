// Program Change decisions are Approve or Reject only: no explanation is
// entered, sent, stored as a reason or shown to the student. Other request
// types keep their explanation. Static checks of the code and of the prepared
// database update (no browser, backend or database). Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { explanationError } from '../src/utils/programChangeDecision.ts'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const PANEL = source('../src/components/programChangeReview/DecisionPanel.tsx')
const SERVICE = source('../src/services/programChangeReview.ts')
const STUDENT_PAGE = source('../src/pages/StudentRequestDetails.tsx')
const STUDENT_SERVICE = source('../src/services/studentRequests.ts')
const IE_SERVICE = source('../src/services/incompleteExamReview.ts')
const CS_SERVICE = source('../src/services/courseSubstitutionReview.ts')
const RC_SERVICE = source('../src/services/raiseCapacityReview.ts')
const IE_PANEL = source('../src/components/incompleteExamReview/DecisionPanel.tsx')
const CS_PANEL = source('../src/components/courseSubstitutionReview/DecisionPanel.tsx')
const RC_PANEL = source('../src/components/review/DecisionPanel.tsx')
const SQL_DIR = '../../database/maintenance/program-change-decision/'
const SQL_INSTALL = source(`${SQL_DIR}01_install.sql`)
const SQL_UPDATE = source(`${SQL_DIR}07_install_no_explanation.sql`)
const SQL_ROLLBACK = source(`${SQL_DIR}09_rollback_no_explanation.sql`)

// The body of decide_program_change_request in a script.
const functionBody = (sql: string) => {
  const start = sql.indexOf('as $fn$')
  const end = sql.indexOf('$fn$;', start + 7)
  assert.ok(start > -1 && end > start, 'function body not found')
  return sql.slice(start, end)
}

test('the admin panel offers only Approve or Reject and Submit Final Decision', () => {
  assert.doesNotMatch(PANEL, /<textarea/)
  assert.doesNotMatch(PANEL, /Explanation to student|setExplanation|explanationError|MAX_EXPLANATION/)
  assert.match(PANEL, /value: 'approve',\s+label: 'Approve'/)
  assert.match(PANEL, /value: 'reject', label: 'Reject'/)
  assert.match(PANEL, /Submit Final Decision/)
  // Only a missing outcome stops the form.
  assert.match(PANEL, /if \(!choice\) return\n\s+setStep\('confirm'\)/)
  assert.match(PANEL, /decideProgramChangeRequest\(request\.id, choice\)/)
  // The recorded decision shows outcome, staff member and date; no note.
  assert.doesNotMatch(PANEL, /pcr-recorded__note|d\.explanation/)
})

test('the decision is sent without an explanation and nothing is generated', () => {
  assert.match(SERVICE, /export async function decideProgramChangeRequest\(\s+requestId: string,\s+choice: DecisionChoice,\s+\): Promise/)
  assert.match(SERVICE, /supabase\.rpc\('decide_program_change_request', \{\s+p_request_id: requestId,\s+p_decision: choice,\s+p_explanation: null,\s+\}\)/)
  assert.doesNotMatch(SERVICE, /Decision_Comment/)
})

test('the student sees the outcome and decision date, with no explanation section for Program Change', () => {
  assert.doesNotMatch(STUDENT_PAGE, /ProgramChangeDecision|useProgramChangeDecision|PROGRAM_CHANGE/)
  assert.doesNotMatch(STUDENT_SERVICE, /get_my_program_change_decision|fetchProgramChangeDecision/)
  // The card: heading from the stored status (Program Change Completed reads
  // "approved"), and the decision date from Request_History.
  assert.match(STUDENT_PAGE, /statusLabel\(request\.status, request\.type, approvalRecorded\) === 'Approved'/)
  assert.match(STUDENT_PAGE, /Decided on \{formatDate\(request\.decision\.date\)\}/)
  assert.match(STUDENT_PAGE, /\{hasExplanation && \(\s+<div className="req-decision__explanation">/)
})

test('other request types still require and show an explanation', () => {
  for (const [name, service] of [['Incomplete Exam', IE_SERVICE], ['Course Substitution', CS_SERVICE],
    ['Raise Capacity', RC_SERVICE]] as const) {
    assert.match(service, /p_explanation: explanation(\.trim\(\))?,/, name)
  }
  for (const [name, panel] of [['Incomplete Exam', IE_PANEL], ['Course Substitution', CS_PANEL],
    ['Raise Capacity', RC_PANEL]] as const) {
    assert.match(panel, /<textarea/, name)
  }
  // The shared rule they use is unchanged.
  assert.match(explanationError('', true) ?? '', /Enter an explanation/)
  assert.match(STUDENT_PAGE, /<RejectionReasonText requestId=\{request\.id\} \/>/)
  assert.match(STUDENT_PAGE, /explanation=\{incompleteExam\.decision\?\.explanation\}/)
  assert.match(STUDENT_PAGE, /explanation=\{courseSubstitution\.decision\?\.explanation\}/)
})

test('the prepared database update removes only the explanation requirement', () => {
  const original = functionBody(SQL_INSTALL)
  const updated = functionBody(SQL_UPDATE)
  const required = "    if v_explanation = '' then\n      raise exception using errcode = '22023', message = 'explanation_required';\n    end if;\n"
  assert.ok(original.includes(required))
  assert.ok(!updated.includes('explanation_required'))
  // Identical apart from the removed check and one comment line.
  const comment = "    -- Optional: absent means '' (Decision_Comment is NOT NULL); never generated.\n"
  assert.equal(updated.replace(comment, ''), original.replace(required, ''))
  // Same security shape, and nothing else in the database is changed.
  assert.match(SQL_UPDATE, /create or replace function public\.decide_program_change_request\(\s+p_request_id\s+character varying,\s+p_decision\s+text,\s+p_explanation text\s+\)\s+returns jsonb\s+language plpgsql\s+security definer\s+set search_path = ''/)
  assert.doesNotMatch(SQL_UPDATE, /^\s*(alter table|drop |create (unique )?index|create policy|grant |revoke )/im)
  assert.equal(SQL_UPDATE.match(/create or replace function/g)?.length, 1)
})

test('the rollback restores the original function exactly', () => {
  assert.equal(functionBody(SQL_ROLLBACK), functionBody(SQL_INSTALL))
  assert.doesNotMatch(SQL_ROLLBACK, /^\s*(alter table|drop |delete |update public\."Decision")/im)
})

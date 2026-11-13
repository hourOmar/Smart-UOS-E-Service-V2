// The student's view of a decided Course Substitution request: a decision is
// shown only with a recorded administrative decision, never inferred from the
// status. Run: npm test (no browser or database).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { toCourseSubstitutionDecisionView } from '../src/utils/courseSubstitutionStudentDecision.ts'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const PAGE = source('../src/pages/StudentRequestDetails.tsx')
const SERVICE = source('../src/services/courseSubstitutionStudent.ts')

test('an approval or rejection with a decision record is shown with its explanation', () => {
  assert.deepEqual(
    toCourseSubstitutionDecisionView({
      decision: 'approve', has_decision_record: true, explanation: '  Approved for this term. ', decided_at: '2026-11-02 08:00:00',
    }),
    { decision: 'approve', hasDecisionRecord: true, explanation: 'Approved for this term.', decidedAt: '2026-11-02T08:00:00Z' },
  )
  const rejected = toCourseSubstitutionDecisionView({
    decision: 'reject', has_decision_record: true, explanation: 'Offered next term.', decided_at: '2026-11-02T08:00:00+00:00',
  })
  assert.equal(rejected?.decision, 'reject')
  assert.equal(rejected?.decidedAt, '2026-11-02T08:00:00+00:00')
  const noText = toCourseSubstitutionDecisionView({ decision: 'reject', has_decision_record: true, explanation: '  ' })
  assert.equal(noText?.explanation, null)
})

test('without a decision record there is no decision, whatever else is returned', () => {
  for (const data of [
    { decision: 'approve', has_decision_record: false, explanation: 'x' },
    { decision: 'approve', explanation: 'x' },
    { decision: 'reject', has_decision_record: 'true' },
    { decision: null, has_decision_record: false },
    null,
    undefined,
    'approve',
  ]) {
    assert.equal(toCourseSubstitutionDecisionView(data), null)
  }
})

test('an unknown decision value is never accepted', () => {
  assert.equal(toCourseSubstitutionDecisionView({ decision: 'Completed', has_decision_record: true }), null)
  assert.equal(toCourseSubstitutionDecisionView({ decision: 'APPROVE', has_decision_record: true }), null)
})

test('the service calls only get_my_course_substitution_decision and throws on errors', () => {
  assert.equal(SERVICE.match(/\.rpc\(/g)?.length, 1)
  assert.match(SERVICE, /supabase\.rpc\('get_my_course_substitution_decision', \{ p_request_id: requestId \}\)/)
  assert.match(SERVICE, /if \(error\) throw error/)
  assert.match(SERVICE, /return toCourseSubstitutionDecisionView\(data\)/)
})

test('the request details page shows the decision only for a decided Course Substitution request', () => {
  assert.match(PAGE, /const showCourseSubstitutionDecision = request\.type === COURSE_SUBSTITUTION && decided/)
  assert.match(PAGE, /useCourseSubstitutionDecision\(request\.id, showCourseSubstitutionDecision\)/)
  assert.match(PAGE, /\{showCourseSubstitutionDecision && \(\s+<DecisionExplanation\s+status=\{courseSubstitution\.status\}\s+explanation=\{courseSubstitution\.decision\?\.explanation\}\s+retry=\{courseSubstitution\.retry\}\s+rejected=\{request\.status === 'Rejected'\}/)
})

test('"Approved" for a Course Substitution comes only from a recorded approval decision', () => {
  assert.match(PAGE, /const courseSubstitutionApproved =\s+courseSubstitution\.decision\?\.decision === 'approve' && courseSubstitution\.decision\.hasDecisionRecord/)
  assert.match(PAGE, /\|\| courseSubstitutionApproved/)
  assert.match(PAGE, /statusLabel\(request\.status, request\.type, approvalRecorded\)/)
})

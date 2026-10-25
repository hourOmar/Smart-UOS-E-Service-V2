// Rules of the administrator's final Program Change decision (the database
// function enforces the same ones). Run: npm test (no browser or database).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DECISION_MESSAGES,
  MAX_EXPLANATION,
  UNKNOWN_DECISION_MESSAGE,
  decisionErrorCode,
  decisionErrorMessage,
  differsFromRecommendation,
  evaluationWarning,
  explanationError,
  explanationLength,
  rerunAllowed,
  type EvaluationSummary,
} from '../src/utils/programChangeDecision.ts'

// -- explanation ----------------------------------------------------------------

test('the explanation is required (after trimming), but only reported once attempted', () => {
  assert.equal(explanationError('', false), null)
  assert.match(explanationError('', true) ?? '', /Enter an explanation/)
  assert.match(explanationError('   \n\t ', true) ?? '', /Enter an explanation/)
})

test('1 to 2000 characters after trimming are accepted', () => {
  assert.equal(MAX_EXPLANATION, 2000)
  assert.equal(explanationError('x', true), null)
  assert.equal(explanationError('x'.repeat(2000), true), null)
  assert.equal(explanationError(`  ${'x'.repeat(2000)}  `, true), null)   // surrounding spaces do not count
})

test('more than 2000 characters is refused', () => {
  assert.match(explanationError('x'.repeat(2001), false) ?? '', /at most 2,000 characters/)
})

test('characters are counted as code points, as the database does', () => {
  assert.equal(explanationLength('😀😀'), 2)
  assert.equal(explanationError('😀'.repeat(2000), true), null)
  assert.notEqual(explanationError('😀'.repeat(2001), true), null)
})

// -- database refusals --------------------------------------------------------------

test('every refusal of decide_program_change_request has a safe message', () => {
  for (const code of ['not_staff', 'invalid_decision', 'explanation_required', 'explanation_too_long',
    'request_not_found', 'not_program_change', 'program_change_details_missing', 'already_decided']) {
    assert.equal(decisionErrorCode({ message: code, code: 'P0001' }), code)
    assert.equal(decisionErrorMessage(code), DECISION_MESSAGES[code])
  }
})

test('staff-only access: a non-staff caller is refused with a staff-facing message', () => {
  assert.equal(decisionErrorCode({ message: 'not_staff', code: '42501' }), 'not_staff')
  assert.match(decisionErrorMessage('not_staff'), /Only staff members/)
})

test('an already decided request is reported, not retried', () => {
  assert.match(decisionErrorMessage('already_decided'), /already been decided/)
})

test('an expired session is recognised', () => {
  assert.equal(decisionErrorCode({ message: 'JWT expired', code: 'PGRST301' }), 'signed_out')
  assert.equal(decisionErrorCode({ message: 'permission denied for function decide_program_change_request' }),
    'signed_out')
})

test('unexpected database errors never reach the administrator', () => {
  const raw = { message: 'duplicate key value violates unique constraint "decision_one_per_program_change_request"' }
  assert.equal(decisionErrorCode(raw), 'unknown')
  assert.equal(decisionErrorMessage('unknown'), UNKNOWN_DECISION_MESSAGE)
  assert.equal(decisionErrorCode(null), 'unknown')
  assert.equal(decisionErrorCode({ message: 'toString' }), 'unknown')        // no prototype keys
  assert.equal(decisionErrorMessage('constructor'), UNKNOWN_DECISION_MESSAGE)
})

// -- the agent is advisory -------------------------------------------------------------

test('a decision that differs from the agent is flagged, never blocked', () => {
  assert.equal(differsFromRecommendation('approve', 'APPROVE'), false)
  assert.equal(differsFromRecommendation('reject', 'REJECT'), false)
  assert.equal(differsFromRecommendation('approve', 'REJECT'), true)
  assert.equal(differsFromRecommendation('reject', 'APPROVE'), true)
  assert.equal(differsFromRecommendation('approve', 'REQUIRES_REVIEW'), true)
  assert.equal(differsFromRecommendation('reject', 'REQUIRES_REVIEW'), true)
  assert.equal(differsFromRecommendation(null, 'REJECT'), false)
  assert.equal(differsFromRecommendation('approve', null), false)
})

const summary = (patch: Partial<EvaluationSummary>): EvaluationSummary => ({
  loading: false, hasCompleted: true, latestFailed: false, running: false, unavailable: false, ...patch,
})

test('no warning with a completed evaluation, or while loading', () => {
  assert.equal(evaluationWarning(summary({})), null)
  assert.equal(evaluationWarning(summary({ loading: true, hasCompleted: false })), null)
})

test('a missing, failed, running or unavailable evaluation is warned about, and the decision stays allowed', () => {
  for (const patch of [{ hasCompleted: false }, { hasCompleted: false, latestFailed: true },
    { running: true }, { unavailable: true, hasCompleted: false }]) {
    const warning = evaluationWarning(summary(patch)) ?? ''
    assert.ok(warning.length > 0, JSON.stringify(patch))
    assert.match(warning, /You can still decide|decide now/)
  }
  assert.match(evaluationWarning(summary({ hasCompleted: false, latestFailed: true })) ?? '', /failed/)
})

// -- re-runs after a decision ------------------------------------------------------------

test('a finalized request is never offered a re-run, even if the API allowed it', () => {
  assert.equal(rerunAllowed('Completed', true, false), false)
  assert.equal(rerunAllowed('Rejected', true, false), false)
  assert.equal(rerunAllowed(null, true, false), false)
})

test('an In Progress request may re-run only when the API allows it and nothing runs', () => {
  assert.equal(rerunAllowed('In Progress', true, false), true)
  assert.equal(rerunAllowed('In Progress', false, false), false)
  assert.equal(rerunAllowed('In Progress', true, true), false)
})

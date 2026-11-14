// Status labels shown to students and staff. Run: npm test (Node's built-in
// test runner; no browser or database).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  APPROVAL_DECISION_TYPES,
  needsApprovalRecord,
  recordedApprovalIds,
  statusLabel,
} from '../src/utils/statusLabels.ts'

test('Program Change: Completed is shown as Approved', () => {
  assert.equal(statusLabel('Completed', 'Program Change'), 'Approved')
})

test('Program Change: Rejected and In Progress are shown as stored', () => {
  assert.equal(statusLabel('Rejected', 'Program Change'), 'Rejected')
  assert.equal(statusLabel('In Progress', 'Program Change'), 'In Progress')
})

test('Raise Capacity is unchanged', () => {
  assert.equal(statusLabel('Completed', 'Raise Capacity'), 'Approved')
  assert.equal(statusLabel('Rejected', 'Raise Capacity'), 'Rejected')
  assert.equal(statusLabel('In Progress', 'Raise Capacity'), 'In Progress')
})

test('Incomplete Exam: Completed is Approved only with a recorded approval decision', () => {
  // Historical Completed requests (no decision record) and views that do not
  // load the decision keep the stored status.
  assert.equal(statusLabel('Completed', 'Incomplete Exam'), 'Completed')
  assert.equal(statusLabel('Completed', 'Incomplete Exam', false), 'Completed')
  assert.equal(statusLabel('Completed', 'Incomplete Exam', true), 'Approved')
  for (const recorded of [true, false]) {
    assert.equal(statusLabel('Rejected', 'Incomplete Exam', recorded), 'Rejected')
    assert.equal(statusLabel('In Progress', 'Incomplete Exam', recorded), 'In Progress')
  }
})

test('Course Substitution: Completed is Approved only with a recorded approval decision', () => {
  assert.equal(statusLabel('Completed', 'Course Substitution'), 'Completed')
  assert.equal(statusLabel('Completed', 'Course Substitution', false), 'Completed')
  assert.equal(statusLabel('Completed', 'Course Substitution', true), 'Approved')
  for (const recorded of [true, false]) {
    assert.equal(statusLabel('Rejected', 'Course Substitution', recorded), 'Rejected')
    assert.equal(statusLabel('In Progress', 'Course Substitution', recorded), 'In Progress')
  }
})

test('the approval flag changes nothing for the other types', () => {
  assert.equal(statusLabel('Completed', 'Program Change', false), 'Approved')
  assert.equal(statusLabel('Completed', 'Raise Capacity', false), 'Approved')
  assert.equal(statusLabel('Completed', 'Course Equivalency', true), 'Completed')
  assert.equal(statusLabel('Completed', null, true), 'Completed')
})

test('other request types keep their stored status', () => {
  for (const type of ['Course Equivalency']) {
    assert.equal(statusLabel('Completed', type), 'Completed')
    assert.equal(statusLabel('Rejected', type), 'Rejected')
    assert.equal(statusLabel('In Progress', type), 'In Progress')
  }
})

// -- lists: which rows need a decision lookup, and which decisions count ----

test('only Completed Incomplete Exam / Course Substitution requests need an approval record', () => {
  assert.equal(needsApprovalRecord('Completed', 'Course Substitution'), true)
  assert.equal(needsApprovalRecord('Completed', 'Incomplete Exam'), true)
  for (const status of ['Rejected', 'In Progress']) {
    assert.equal(needsApprovalRecord(status, 'Course Substitution'), false)
    assert.equal(needsApprovalRecord(status, 'Incomplete Exam'), false)
  }
  // Their 'Completed' is always an approval, or never: no lookup.
  for (const type of ['Raise Capacity', 'Program Change', 'Course Equivalency', null, undefined]) {
    assert.equal(needsApprovalRecord('Completed', type), false)
  }
  assert.deepEqual(APPROVAL_DECISION_TYPES, {
    'Incomplete Exam': 'Incomplete Exam Approved',
    'Course Substitution': 'Course Substitution Approved',
  })
})

test('a row reads Approved only with an approval decision of its own type', () => {
  const rows = [
    { id: 'CS1', type: 'Course Substitution', status: 'Completed' },   // approved
    { id: 'CS2', type: 'Course Substitution', status: 'Completed' },   // completed without a record
    { id: 'CS3', type: 'Course Substitution', status: 'Rejected' },
    { id: 'IE1', type: 'Incomplete Exam', status: 'Completed' },       // approved
    { id: 'IE2', type: 'Incomplete Exam', status: 'Completed' },       // wrong decision type
    { id: 'CS4', type: 'Course Substitution', status: 'In Progress' },
  ]
  const decisions = [
    { requestId: 'CS1', decisionType: 'Course Substitution Approved' },
    { requestId: 'CS2', decisionType: 'Course Substitution Rejected' },
    { requestId: 'CS3', decisionType: 'Course Substitution Approved' },
    { requestId: 'IE1', decisionType: 'Incomplete Exam Approved' },
    { requestId: 'IE2', decisionType: 'Course Substitution Approved' },
    { requestId: 'CS4', decisionType: 'Course Substitution Approved' },
    { requestId: 'UNKNOWN', decisionType: 'Course Substitution Approved' },
  ]
  const approved = recordedApprovalIds(rows, decisions)
  assert.deepEqual([...approved].sort(), ['CS1', 'IE1'])
  // The badge label each list row then shows: the same rule as the details page.
  assert.deepEqual(
    rows.map((r) => statusLabel(r.status, r.type, approved.has(r.id))),
    ['Approved', 'Completed', 'Rejected', 'Approved', 'Completed', 'In Progress'],
  )
  assert.equal(recordedApprovalIds(rows, []).size, 0)
})

test('an unknown or missing type keeps the stored status', () => {
  assert.equal(statusLabel('Completed'), 'Completed')
  assert.equal(statusLabel('Completed', null), 'Completed')
  assert.equal(statusLabel('Completed', 'program change'), 'Completed')   // exact type only
})

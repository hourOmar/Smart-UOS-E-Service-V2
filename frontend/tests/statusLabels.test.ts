// Status labels shown to students and staff. Run: npm test (Node's built-in
// test runner; no browser or database).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { statusLabel } from '../src/utils/statusLabels.ts'

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

test('an unknown or missing type keeps the stored status', () => {
  assert.equal(statusLabel('Completed'), 'Completed')
  assert.equal(statusLabel('Completed', null), 'Completed')
  assert.equal(statusLabel('Completed', 'program change'), 'Completed')   // exact type only
})

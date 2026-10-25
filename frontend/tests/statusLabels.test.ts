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

test('other request types keep their stored status', () => {
  for (const type of ['Incomplete Exam', 'Course Equivalency', 'Course Substitution']) {
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

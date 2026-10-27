// Dashboard quick search ranking (prototype v3). Run: npm test (Node's
// built-in test runner; no browser or database).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rankServices, scoreService } from '../src/utils/serviceSearch.ts'

test('an empty query matches every service', () => {
  assert.equal(scoreService('  ', 'Raise Capacity'), 1)
})

test('name matches outrank keyword and description matches', () => {
  assert.equal(scoreService('raise capacity', 'Raise Capacity'), 100)
  assert.equal(scoreService('rai', 'Raise Capacity'), 80)
  assert.equal(scoreService('cap', 'Raise Capacity'), 60)
  assert.equal(scoreService('seat', 'Raise Capacity', 'seat section full'), 40)
  assert.equal(scoreService('reached', 'Raise Capacity', '', 'A section that has reached its capacity.'), 20)
})

test('short queries only match the start of the name or a word in it', () => {
  assert.equal(scoreService('ap', 'Raise Capacity'), 0)
  assert.equal(scoreService('ca', 'Raise Capacity'), 60)
  assert.equal(scoreService('apa', 'Raise Capacity'), 50)
})

test('matches are ranked best first and ties keep catalog order', () => {
  const names = ['Incomplete Exam', 'Midterm Makeup Exam', 'Exam Results']
  const ranked = rankServices(names, (name) => scoreService('exam', name))
  assert.deepEqual(ranked, ['Exam Results', 'Incomplete Exam', 'Midterm Makeup Exam'])
})

test('services that do not match are left out', () => {
  assert.deepEqual(rankServices(['Raise Capacity', 'Program Change'], (name) => scoreService('program', name)), [
    'Program Change',
  ])
})

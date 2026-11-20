// The student's reason in all five Academic Request forms: required (not empty
// after trimming), at most 1000 characters, and no minimum length. The database
// functions enforce the same rule. Run: npm test (no browser or database).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { justificationError, JUSTIFICATION_MAX_LENGTH } from '../src/utils/raiseCapacityJustification.ts'
import { reasonError as incompleteExamReason, REASON_MAX_LENGTH as IE_MAX } from '../src/utils/incompleteExamSubmission.ts'
import { reasonError as programChangeReason, REASON_MAX_LENGTH as PC_MAX } from '../src/utils/programChangeReason.ts'
import { reasonError as courseEquivalencyReason, REASON_MAX_LENGTH as CE_MAX } from '../src/utils/courseEquivalencySubmission.ts'
import { reasonError as courseSubstitutionReason, REASON_MAX_LENGTH as CS_MAX } from '../src/utils/courseSubstitutionSubmission.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const SERVICES: [string, (reason: string) => string | null, number][] = [
  ['Raise Capacity', justificationError, JUSTIFICATION_MAX_LENGTH],
  ['Incomplete Exam', incompleteExamReason, IE_MAX],
  ['Program Change', programChangeReason, PC_MAX],
  ['Course Equivalency', courseEquivalencyReason, CE_MAX],
  ['Course Substitution', courseSubstitutionReason, CS_MAX],
]

for (const [name, check, max] of SERVICES) {
  test(`${name}: any non-empty reason up to 1000 characters is accepted`, () => {
    assert.equal(max, 1000)
    for (const ok of ['x', 'OK', 'Personal reason', 'x'.repeat(19), '  x  ', 'x'.repeat(1000), ` ${'x'.repeat(1000)} `]) {
      assert.equal(check(ok), null, `${name}: ${ok.length} characters`)
    }
  })

  test(`${name}: empty, whitespace-only and over-1000 reasons are refused`, () => {
    for (const blank of ['', '   ', ' \n\t ']) {
      const message = check(blank)
      assert.ok(message, `${name}: blank must be refused`)
      assert.doesNotMatch(message, /\d/, `${name}: the required message names no length`)
    }
    assert.match(check('x'.repeat(1001)) ?? '', /at most 1000 characters/, `${name}: 1001 characters`)
  })
}

test('no form or rule module keeps a minimum length', () => {
  for (const path of ['../src/pages/RaiseCapacityForm.tsx', '../src/utils/raiseCapacityJustification.ts',
    '../src/utils/incompleteExamSubmission.ts', '../src/utils/programChangeReason.ts', '../src/services/programChange.ts',
    '../src/utils/courseEquivalencySubmission.ts', '../src/utils/courseSubstitutionSubmission.ts']) {
    const source = read(path)
    assert.doesNotMatch(source, /MIN_LENGTH|at least \$\{|at least 20|20-1000|20 to 1000/, path)
  }
})

test('the forms use these rules', () => {
  assert.match(read('../src/pages/RaiseCapacityForm.tsx'), /justificationError\(justification\)/)
  assert.match(read('../src/services/programChange.ts'), /export \{ REASON_MAX_LENGTH, reasonError \} from '\.\.\/utils\/programChangeReason'/)
  assert.match(read('../src/pages/ProgramChangeForm.tsx'), /reasonError\(reason\) === null/)
})

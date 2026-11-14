// The Raise Capacity review page's Priority assessment: the saved result the
// requests table shows, read only, below the Eligibility recommendation.
// Static checks of the wiring (no browser, backend or database). Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const PAGE = source('../src/pages/AdminRaiseCapacityReview.tsx')
const PANEL = source('../src/components/review/PriorityPanel.tsx')
const HOOK = source('../src/hooks/useRaiseCapacityPriority.ts')
const CELL = source('../src/components/admin/PriorityCell.tsx')
const SERVICE = source('../src/services/raiseCapacityPriority.ts')

test('the page shows the Priority assessment directly above the Eligibility recommendation', () => {
  const priority = PAGE.indexOf('<PriorityPanel')
  const eligibility = PAGE.indexOf('<EligibilityPanel')
  const evidence = PAGE.indexOf('<EvidencePanel')
  assert.ok(priority > -1 && eligibility > priority && evidence > eligibility)
  // Nothing but the priority panel's own props sits between the two panels.
  assert.match(PAGE.slice(priority, eligibility), /^<PriorityPanel[^<]*\/>\s*$/)
  assert.match(PAGE, /const priority = useRaiseCapacityPriority\(requestId\)/)
})

test('the priority is only read, from the same endpoint as the requests table', () => {
  assert.match(HOOK, /fetchPriorities\(\[requestId\]\)/)
  for (const file of [HOOK, PANEL, PAGE]) {
    assert.doesNotMatch(file, /startAutomaticPriorities|retryPriority|useRaiseCapacityPriorities/)
  }
  assert.match(SERVICE, /export async function fetchPriorities[\s\S]*?`\$\{BASE\}\/priorities\?\$\{query\}`/)
})

test('a read failure is an error with Try again, never "no priority"', () => {
  assert.match(HOOK, /status: 'error',\s+data: null,/)
  assert.match(PANEL, /status === 'error' &&[\s\S]*?The priority assessment could not be loaded\.[\s\S]*?onClick=\{onRetry\}/)
  assert.match(PANEL, /status === 'ready' && \(data \? <PriorityStateView data=\{data\} \/> : <NoAssessment \/>\)/)
})

test('the saved level uses the table\'s labels and pill colours', () => {
  assert.match(SERVICE, /export const PRIORITY_LABELS: Record<PriorityLevel, string>/)
  assert.match(CELL, /import \{ PRIORITY_LABELS \} from '\.\.\/\.\.\/services\/raiseCapacityPriority'/)
  assert.match(PANEL, /import \{\s+PRIORITY_LABELS,[\s\S]*?\} from '\.\.\/\.\.\/services\/raiseCapacityPriority'/)
  assert.doesNotMatch(CELL, /const PRIORITY_LABELS/)
  assert.match(PANEL, /<span className="adm-prio-pill" data-level=\{level\}>\s*\{PRIORITY_LABELS\[level\]\}/)
  // Only a 'saved' state shows a level.
  assert.match(PANEL, /case 'saved':\s+return data\.priority \? <PriorityCard level=\{data\.priority\}/)
})

test('the agent\'s stored reasoning, factors and evidence are shown as stored', () => {
  assert.match(PANEL, /\{result\?\.reasoning && <p className="rv-rec__reasoning">\{result\.reasoning\}<\/p>\}/)
  assert.match(PANEL, /<dd>\{factors\[field\]\}<\/dd>/)
  assert.match(PANEL, /<li key=\{index\}>\{item\}<\/li>/)
  for (const field of ['graduation', 'degree_progress', 'course_requirement', 'course_availability',
    'previous_attempts', 'prerequisite', 'progression']) {
    assert.match(PANEL, new RegExp(`\\['${field}', '`))
    assert.match(SERVICE, new RegExp(`  ${field}: string`))
  }
})

test('the section is advisory and never offers a decision or a retry', () => {
  assert.match(PANEL, /does not\s+approve or reject the request; staff make the decision\./)
  // onRetry only reloads the saved state after a read failure ("Try again").
  assert.doesNotMatch(PANEL, />\s*Retry|'Retry|onRerun|decide_/)
  assert.equal(PANEL.match(/onClick=/g)?.length, 1)
})

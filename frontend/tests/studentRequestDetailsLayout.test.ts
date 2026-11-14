// The student request details page layout (one page for every request type):
// header with the copyable request ID, Request Details and Request Progress
// side by side, and the Final Decision card across the full width below
// them, shown only once the request is decided. Static checks of the page
// source and its stylesheet (no browser, backend or database). Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const PAGE = source('../src/pages/StudentRequestDetails.tsx')
const PARTS = source('../src/components/requests/RequestDetailParts.tsx')
const CSS = source('../src/components/requests/Requests.css')
const APP = source('../src/App.tsx')

const body = PAGE.slice(PAGE.indexOf('function RequestBody'), PAGE.indexOf('function StudentRequestDetails'))
const at = (text: string) => {
  const index = body.indexOf(text)
  assert.ok(index >= 0, `missing: ${text}`)
  return index
}

test('one details page serves every request type', () => {
  assert.equal(APP.match(/<StudentRequestDetails \/>/g)?.length, 1)
  assert.match(APP, /path="\/student\/requests\/:requestId"/)
})

test('header: type as title, summary, copyable ID, submission date and status', () => {
  assert.match(body, /<h1 className="req-detail__title">\{request\.type\} Request<\/h1>/)
  assert.match(body, /\{request\.title && <p className="req-hero__subtitle">\{request\.title\}<\/p>\}/)
  assert.match(body, /<CopyRequestId requestId=\{request\.id\} \/>/)
  assert.match(body, /Submitted \{formatDate\(request\.date\)\}/)
  assert.match(body, /<RequestStatusBadge status=\{request\.status\} requestType=\{request\.type\} approvalRecorded=\{approvalRecorded\} \/>/)
})

test('Request Details and Request Progress first, then the Final Decision across the full width', () => {
  const columns = at('<div className="req-detail__columns">')
  const details = at('Request Details')
  const documents = at('<StudentProofDocuments requestId={request.id} paths={request.documents} />')
  const progress = at('<Progress request={request} approvalRecorded={approvalRecorded} />')
  const decision = at('className="req-decision"')
  const awaiting = at('className="req-awaiting"')
  assert.ok(columns < details && details < documents && documents < progress)
  assert.ok(progress < decision && decision < awaiting)
  // The decision card is outside the two columns.
  const columnsBlock = body.slice(columns, decision)
  assert.equal((columnsBlock.match(/<div/g) ?? []).length, (columnsBlock.match(/<\/div>/g) ?? []).length)
  assert.match(CSS, /\.req-detail__columns \{\s+display: grid;\s+grid-template-columns: minmax\(0, 1\.75fr\) minmax\(280px, 1fr\);/)
})

test('the Final Decision card appears only for a decided request, with the saved explanation', () => {
  // decisionHeading returns a heading only for Completed or Rejected.
  assert.match(PAGE, /const DECISION_HEADINGS: Record<string, \{ tone: string; glyph: string; heading: string \}> = \{\s+Completed: [^\n]+\n\s+Rejected: [^\n]+\n\}/)
  assert.match(body, /\{decision \? \(\s+<section\s+className="req-decision"/)
  assert.match(body, /<strong>No decision yet\.<\/strong> Your request is being reviewed\./)
  const card = body.slice(at('className="req-decision"'), at('className="req-awaiting"'))
  assert.match(card, /data-tone=\{decision\.tone\}/)
  assert.match(card, /<DetailIcon name=\{decision\.tone === 'rejected' \? 'cross' : 'check'\} \/>/)
  assert.match(card, /Final Decision/)
  assert.match(card, /\{decision\.heading\}/)
  assert.match(card, /Decided on \{formatDate\(request\.decision\.date\)\}/)
  // Every explained type's explanation is inside the card, shown exactly as
  // loaded. Program Change decisions have no explanation: outcome and date only.
  for (const part of ['<RejectionReasonText', 'explanation={incompleteExam.decision?.explanation}', 'explanation={courseSubstitution.decision?.explanation}']) {
    assert.ok(card.includes(part), part)
  }
  assert.ok(!PAGE.includes('ProgramChangeDecisionText'))
  assert.match(PAGE, /const hasExplanation = showRejectionReason \|\| showIncompleteExamDecision \|\| showCourseSubstitutionDecision\n/)
  assert.match(PAGE, /<p className="req-text__body">\{explanation\}<\/p>/)
  assert.match(PAGE, /<p className="req-text__body">\{reason\.explanation\}<\/p>/)
  // Light green for an approval, light red for a rejection.
  assert.match(CSS, /\.req-decision\[data-tone='completed'\] \{[^}]*background: #eef7f2;/)
  assert.match(CSS, /\.req-decision\[data-tone='rejected'\] \{[^}]*background: #fdf1ef;/)
})

test('progress: the same three stages, green when done, red when rejected', () => {
  const progress = PAGE.slice(PAGE.indexOf('function Progress'), PAGE.indexOf('function RequestBody'))
  // Submitted, Under Review, then the decided stage or 'Decision' (not yet decided).
  assert.deepEqual(progress.match(/\btitle: ['`][^'`$]*/g), [
    "title: 'Request Submitted",
    "title: 'Under Review",
    'title: `Request ',
    "title: 'Decision",
  ])
  assert.match(progress, /title: `Request \$\{statusLabel\(request\.status, request\.type, approvalRecorded\)\}`/)
  assert.match(progress, /meta: request\.decision \? formatDate\(request\.decision\.date\) : ''/)
  assert.match(progress, /state: request\.status === 'Rejected' \? 'rejected' : 'done'/)
  assert.match(progress, /\{ title: 'Decision', meta: 'Not yet decided', state: 'pending' \}/)
  assert.match(CSS, /\.req-progress__step\[data-state='done'\] \.req-progress__dot \{[^}]*background: var\(--proto-green\);/)
  assert.match(CSS, /\.req-progress__step\[data-state='rejected'\] \.req-progress__dot \{[^}]*background: #b3261e;/)
})

test('the request ID can be copied, and the result is announced', () => {
  assert.match(PARTS, /await navigator\.clipboard\.writeText\(requestId\)/)
  assert.match(PARTS, /aria-label=\{`Copy request ID \$\{requestId\}`\}/)
  assert.match(PARTS, /role="status" aria-live="polite"/)
  assert.match(PARTS, /\} catch \{\s+setState\('failed'\)/)
})

test('loading, error and not-found states are kept', () => {
  assert.match(PAGE, /Loading request details…/)
  assert.match(PAGE, /We couldn’t load this request\./)
  assert.match(PAGE, /Request not found/)
  assert.match(PAGE, /<div className="req-page req-details">/)
})

test('the redesign is scoped: shared card, field and text styles are unchanged elsewhere', () => {
  // The admin review pages and My Profile use .req-panel, .req-fields and
  // .req-text too; every new rule for them is under .req-details.
  for (const selector of ['.req-panel', '.req-panel__title', '.req-panel__body', '.req-fields', '.req-text']) {
    const escaped = selector.replace(/[.]/g, '\\.')
    const overrides = CSS.match(new RegExp(`^[^\\n{]*${escaped}\\b[^\\n{]*\\{`, 'gm')) ?? []
    for (const rule of overrides) {
      if (/req-details|req-decision__explanation/.test(rule)) continue
      // The only unscoped rules are the original base ones.
      assert.ok(
        [`.req-panel {`, `.student .req-panel__title {`, `.req-panel__body {`, `.req-fields {`, `.req-fields__item {`, `.req-fields__item dt {`, `.req-fields__item dd {`, `.req-fields__item--wide {`, `.req-text {`, `.req-text__label {`, `.req-text__body {`].includes(rule.trim()),
        `unscoped override: ${rule}`,
      )
    }
  }
})

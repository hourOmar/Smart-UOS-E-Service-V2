// The five Academic Request service-details pages: every section is filled,
// the approved wording matches the implemented rules, and claims that are not
// implemented or not confirmed (processing times, fees, unconfirmed policies)
// never appear. Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { academicRequestTypes, getAcademicRequest } from '../src/data/academicRequests.ts'
import { MAX_PROOF_FILES } from '../src/utils/incompleteExamSubmission.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const entry = (id: string) => {
  const found = getAcademicRequest(id)
  assert.ok(found, id)
  return found
}
const allText = (id: string) => {
  const e = entry(id)
  const d = e.details
  return [e.description, d.description, d.audience, d.requirements, d.supportingDocuments,
    ...d.steps, ...d.requiredDocuments, ...d.notes, ...d.checklist].join(' ')
}

test('all five services fill every section (no empty placeholder sections)', () => {
  assert.deepEqual(academicRequestTypes.map((r) => r.id),
    ['raise-capacity', 'incomplete-exam', 'program-change', 'course-equivalency', 'course-substitution'])
  for (const { id, description, details } of academicRequestTypes) {
    assert.ok(description.trim(), `${id} subtitle`)
    for (const field of ['description', 'audience', 'requirements', 'supportingDocuments'] as const) {
      assert.ok(details[field].trim(), `${id} ${field}`)
    }
    for (const list of ['steps', 'requiredDocuments', 'notes', 'checklist'] as const) {
      assert.ok(details[list].length > 0, `${id} ${list}`)
      for (const item of details[list]) assert.ok(item.trim(), `${id} ${list} item`)
    }
    assert.equal(details.steps.length, 5, `${id} steps`)
    assert.equal(details.steps[0], 'Select Start request on this page.')
  }
})

const REVIEW_NOTE =
  'An automated eligibility check reviews your request and prepares a recommendation. The final decision is made by authorized university staff.'

test('no service shows the recommendation note; all five show the status note', () => {
  for (const { id, details } of academicRequestTypes) {
    assert.ok(!details.notes.includes(REVIEW_NOTE), id)
    assert.ok(details.notes.includes('Status updates and the decision appear in My Requests.'), id)
  }
  // The other subtitles are unchanged.
  assert.deepEqual(academicRequestTypes.filter((r) => r.id !== 'raise-capacity' && r.id !== 'course-equivalency')
    .map((r) => r.description), [
    'Request an incomplete for a final exam you were unable to attend.',
    'Apply to move from your current program to another major or program.',
    'Request to replace a course in your study plan with another course.',
  ])
})

test('no unimplemented or unconfirmed claims appear on any page', () => {
  for (const { id } of academicRequestTypes) {
    const text = allText(id)
    for (const forbidden of [/final semester/i, /free of charge/i, /business days/i, /processing time/i,
      /Registrar/i, /65 credit/i, /one semester/i, /\bC\+/, /\bTR\b/, /misreading/i, /job obligations/i]) {
      assert.doesNotMatch(text, forbidden, `${id}: ${forbidden}`)
    }
  }
})

test('Raise Capacity: approved text; the form uses the shared justification rule', () => {
  const rc = entry('raise-capacity')
  assert.equal(rc.description, 'Request an increase in the capacity of a full course section.')
  assert.equal(rc.details.audience, 'Students who want to enroll in a course section that has reached its maximum capacity.')
  assert.equal(rc.details.requirements, 'Students should meet the course prerequisites and any required completed credit hours.')
  assert.equal(rc.details.description,
    'If a course section is full and you need to enroll in it, you can submit a Raise Capacity request to ask the university to increase the number of available seats in that section.')
  assert.deepEqual(rc.details.notes, [
    'Your request is reviewed against the course prerequisites and the additional seats the section can accommodate.',
    'You can have only one Raise Capacity request in progress for the same section.',
    "Submitting a request does not guarantee that the section's capacity will be increased.",
    'Status updates and the decision appear in My Requests.',
  ])
  // Sections kept unchanged.
  assert.equal(rc.details.supportingDocuments, 'None.')
  assert.deepEqual(rc.details.steps, [
    'Select Start request on this page.',
    'Search for the course and choose the section.',
    'Explain why you need a seat in this section.',
    'Review the summary and submit.',
    'Track the status and decision in My Requests.',
  ])
  assert.deepEqual(rc.details.requiredDocuments, ['No documents are needed for this request.'])
  assert.deepEqual(rc.details.checklist, [
    'Know the course code and section you want.',
    'Check that you have completed the course prerequisites.',
    'Prepare a clear reason for your request.',
  ])
  // Validation: required and at most 1000 characters, no minimum (tests/reasonLength.test.ts).
  const FORM = read('../src/pages/RaiseCapacityForm.tsx')
  assert.match(FORM, /const justificationMessage = justificationError\(justification\)/)
  assert.doesNotMatch(FORM, /MIN_LENGTH|at least/)
  assert.match(read('../src/components/raiseCapacity/JustificationField.tsx'),
    /import \{ JUSTIFICATION_MAX_LENGTH \} from '\.\.\/\.\.\/utils\/raiseCapacityJustification'/)
})

test('Incomplete Exam: approved wording; documents optional; limit matches the upload code', () => {
  const ie = entry('incomplete-exam')
  const d = ie.details
  assert.equal(d.requirements,
    'Submit your request within four working days of the missed exam. Late requests may still be submitted but may not be accepted.')
  assert.equal(d.supportingDocuments,
    'You may provide supporting evidence to justify your request. You may upload up to five PDF files.')
  assert.equal(MAX_PROOF_FILES, 5)   // "up to five PDF files" is the real limit
  assert.deepEqual(d.requiredDocuments, [
    'Supporting documents are optional but recommended. Requests without sufficient evidence may not be accepted.',
  ])
  assert.deepEqual(d.notes, [
    'Incomplete Exam requests are for final exams only. Midterm exams have a separate request service.',
    'You can have only one request in progress for the same exam.',
    'Status updates and the decision appear in My Requests.',
  ])
  // Sections kept unchanged.
  assert.equal(ie.description, 'Request an incomplete for a final exam you were unable to attend.')
  assert.equal(d.audience, 'Students registered in the course section of the missed exam.')
  assert.equal(d.description,
    "Request an incomplete for a final exam you were unable to attend. You'll provide: the course section, the date and time of the missed final exam, your explanation and, if you have them, supporting PDF documents.")
  assert.deepEqual(d.steps, [
    'Select Start request on this page.',
    'Choose the course section of the final exam you missed.',
    'Enter the date and time of the missed final exam and explain what happened.',
    'Attach supporting PDF documents, if you have them.',
    'Submit, then track the status and decision in My Requests.',
  ])
  assert.deepEqual(d.checklist, [
    'Know the course section of the missed final exam.',
    'Have the date and time of the missed final exam.',
    'Prepare a clear reason for your request.',
    'Have your supporting documents ready as PDF files, if any.',
  ])
  // The explanation has no minimum length any more.
  assert.doesNotMatch(allText('incomplete-exam'), /20 characters/)
})

test('Program Change: approved wording; other sections unchanged', () => {
  const pc = entry('program-change')
  const d = pc.details
  assert.equal(d.audience, 'Students who want to move from their current program to another program.')
  assert.deepEqual(d.steps, [
    'Select Start request on this page.',
    'Choose the college, then the program you want to move to.',
    'Explain your reason for the change.',
    'Submit your request.',
    'Track the status and decision in My Requests.',
  ])
  assert.deepEqual(d.notes, [
    'You can apply again after your request has been decided.',
    'After an approved program change, you can request Course Equivalency for courses you have completed.',
    'Status updates and the decision appear in My Requests.',
  ])
  // The CGPA / applicable-credit-hour criteria are no longer described in the notes.
  assert.doesNotMatch(d.notes.join(' '), /CGPA|credit hours/)
  // Sections kept unchanged.
  assert.equal(pc.description, 'Apply to move from your current program to another major or program.')
  assert.equal(d.requirements,
    'You must choose a program different from your current one, and you can have only one Program Change request in progress at a time.')
  assert.equal(d.supportingDocuments, 'None.')
  assert.equal(d.description,
    "Apply to move from your current program to another program. You'll provide the college and program you want to move to and your reason for the change.")
  assert.deepEqual(d.requiredDocuments, ['No documents are needed for this request.'])
  assert.deepEqual(d.checklist, [
    'Know the college and program you want to move to.',
    'Check your CGPA and completed courses.',
    'Prepare a clear reason for your request.',
  ])
  // The form keeps its 1000-character maximum and has no minimum (tests/reasonLength.test.ts).
  const PC = read('../src/utils/programChangeReason.ts')
  assert.match(PC, /export const REASON_MAX_LENGTH = 1000/)
  assert.doesNotMatch(PC + read('../src/services/programChange.ts'), /MIN_LENGTH|at least/)
})

test('Course Equivalency: approved "not considered equivalent" wording; other sections unchanged', () => {
  const ce = entry('course-equivalency')
  const d = ce.details
  assert.equal(ce.description,
    'Request equivalency for a course that was not considered equivalent after your Program Change.')
  assert.equal(d.audience,
    'Students who want to request equivalency for courses that were not considered equivalent after an approved Program Change.')
  assert.equal(d.description,
    'After your Program Change is approved, some courses from your previous program may be considered equivalent to courses in your new program. If a course was not considered equivalent, you can submit a Course Equivalency request to have it reviewed.')
  assert.equal(d.requirements, 'You must have an approved Program Change request.')
  assert.equal(d.supportingDocuments, 'None.')
  assert.deepEqual(d.steps, [
    'Select Start request on this page.',
    'Choose a course from your transcript with a recorded grade.',
    "Choose the course in your new program's study plan.",
    'Explain your reason.',
    'Submit, then track the status and decision in My Requests.',
  ])
  assert.deepEqual(d.notes, [
    'You can have only one request in progress for the same pair of courses.',
    'Submitting a request does not guarantee equivalency. The review compares the content of both courses using their syllabi and considers your grade and the credit hours.',
    'Status updates and the decision appear in My Requests.',
  ])
  assert.deepEqual(d.checklist, [
    'Make sure your Program Change has been approved.',
    'Know which course from your transcript should count as which course in your new study plan.',
    'Prepare a clear reason for your request.',
  ])
  assert.deepEqual(d.requiredDocuments, ['No documents are needed from you.'])
  // No automatic-equivalency claim and no character counts on the page.
  assert.doesNotMatch(allText('course-equivalency'), /automatic|\d+ characters|20 to 1000/i)
  // The form keeps its 1000-character maximum and has no minimum.
  const SUB = read('../src/utils/courseEquivalencySubmission.ts')
  assert.match(SUB, /export const REASON_MAX_LENGTH = 1000/)
  assert.doesNotMatch(SUB, /MIN_LENGTH/)
})

test('Course Substitution: approved simplified wording; other sections unchanged', () => {
  const cs = entry('course-substitution')
  const d = cs.details
  assert.equal(d.audience, 'Students who want to replace a required course in their study plan with another course.')
  assert.equal(d.requirements,
    'The course you want to replace must be a required course in your study plan. You must not have passed or currently be enrolled in either course.')
  assert.equal(d.description,
    "Course Substitution allows you to request replacing a required course in your study plan with another course. You'll provide the course you want to replace, the course you want to take instead, and your reason.")
  assert.deepEqual(d.steps, [
    'Select Start request on this page.',
    'Choose the Required course you want to replace.',
    'Choose the Elective course you want to take instead.',
    'Explain your reason.',
    'Submit, then track the status and decision in My Requests.',
  ])
  assert.deepEqual(d.notes, [
    'Courses you have passed or are currently taking are not available for selection. Courses you have only failed may still be selected.',
    'You can have only one request in progress for the same original course.',
    'Status updates and the decision appear in My Requests.',
  ])
  assert.deepEqual(d.checklist, [
    'Know the codes of the course you want to replace and the course you want to take instead.',
    'Prepare a clear reason for your request.',
  ])
  // Sections kept unchanged.
  assert.equal(cs.name, 'Course Substitution')
  assert.equal(cs.description, 'Request to replace a course in your study plan with another course.')
  assert.equal(d.supportingDocuments, 'None.')
  assert.deepEqual(d.requiredDocuments, ['No documents are needed for this request.'])
  assert.doesNotMatch(allText('course-substitution'), /major course|\d+ characters|20 to 1000/i)
  // The form keeps its 1000-character maximum and has no minimum.
  const SUB = read('../src/utils/courseSubstitutionSubmission.ts')
  assert.match(SUB, /export const REASON_MAX_LENGTH = 1000/)
  assert.doesNotMatch(SUB, /MIN_LENGTH/)
})

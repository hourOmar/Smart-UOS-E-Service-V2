// The five academic request services offered by Smart UoS E-Service, in the
// catalog order of the final prototype (Smart UoS E-Service v3.dc.html).
// Fixed application content, reviewed against the implemented submission
// rules (2026-11-20). Submission requirements are stated as such; checks made
// by the automated eligibility agents are described as review criteria, and
// the final decision is always made by authorized university staff. No
// processing time, fee or unconfirmed university policy is stated.
// Student data and submitted requests always come from the database.

export type AcademicRequestId =
  | 'raise-capacity'
  | 'incomplete-exam'
  | 'course-substitution'
  | 'program-change'
  | 'course-equivalency'

/** Details-page content. Empty strings and lists are shown as empty sections. */
export interface AcademicRequestDetails {
  /** "Description" accordion. */
  description: string
  /** Summary strip: "Target Audience". */
  audience: string
  /** Summary strip: "Requirements" (eligibility). */
  requirements: string
  /** Summary strip: "Supporting Documents". */
  supportingDocuments: string
  /** "Submission Steps" accordion (numbered). */
  steps: string[]
  /** "Required Documents" accordion. */
  requiredDocuments: string[]
  /** "Important Notes" accordion. */
  notes: string[]
  /** "Before you submit" checklist. */
  checklist: string[]
}

export interface AcademicRequestType {
  id: AcademicRequestId
  name: string
  /** Catalog card text, also shown under the title on the details page. */
  description: string
  /** Extra search words, matched along with the name and description. */
  keywords: string
  details: AcademicRequestDetails
  /**
   * Route of the real request form. Leave unset until that form exists;
   * until then "Start request" is shown disabled.
   */
  startPath?: string
}

// Shared closing note used by all five services.
const STATUS_NOTE = 'Status updates and the decision appear in My Requests.'

export const academicRequestTypes: AcademicRequestType[] = [
  {
    id: 'raise-capacity',
    name: 'Raise Capacity',
    description: 'Request an increase in the capacity of a full course section.',
    keywords: 'seat section full capacity course register',
    details: {
      description:
        'If a course section is full and you need to enroll in it, you can submit a Raise Capacity request to ask the university to increase the number of available seats in that section.',
      audience: 'Students who want to enroll in a course section that has reached its maximum capacity.',
      requirements: 'Students should meet the course prerequisites and any required completed credit hours.',
      supportingDocuments: 'None.',
      steps: [
        'Select Start request on this page.',
        'Search for the course and choose the section.',
        'Explain why you need a seat in this section.',
        'Review the summary and submit.',
        'Track the status and decision in My Requests.',
      ],
      requiredDocuments: ['No documents are needed for this request.'],
      notes: [
        'Your request is reviewed against the course prerequisites and the additional seats the section can accommodate.',
        'You can have only one Raise Capacity request in progress for the same section.',
        "Submitting a request does not guarantee that the section's capacity will be increased.",
        STATUS_NOTE,
      ],
      checklist: [
        'Know the course code and section you want.',
        'Check that you have completed the course prerequisites.',
        'Prepare a clear reason for your request.',
      ],
    },
    startPath: '/student/services/raise-capacity/new',
  },
  {
    id: 'incomplete-exam',
    name: 'Incomplete Exam',
    description:
      'Request an incomplete for a final exam you were unable to attend.',
    keywords: 'exam final missed medical incomplete',
    details: {
      description:
        "Request an incomplete for a final exam you were unable to attend. You'll provide: the course section, the date and time of the missed final exam, your explanation and, if you have them, supporting PDF documents.",
      audience: 'Students registered in the course section of the missed exam.',
      requirements:
        'Submit your request within four working days of the missed exam. Late requests may still be submitted but may not be accepted.',
      supportingDocuments:
        'You may provide supporting evidence to justify your request. You may upload up to five PDF files.',
      steps: [
        'Select Start request on this page.',
        'Choose the course section of the final exam you missed.',
        'Enter the date and time of the missed final exam and explain what happened.',
        'Attach supporting PDF documents, if you have them.',
        'Submit, then track the status and decision in My Requests.',
      ],
      requiredDocuments: [
        'Supporting documents are optional but recommended. Requests without sufficient evidence may not be accepted.',
      ],
      notes: [
        'Incomplete Exam requests are for final exams only. Midterm exams have a separate request service.',
        'You can have only one request in progress for the same exam.',
        STATUS_NOTE,
      ],
      checklist: [
        'Know the course section of the missed final exam.',
        'Have the date and time of the missed final exam.',
        'Prepare a clear reason for your request.',
        'Have your supporting documents ready as PDF files, if any.',
      ],
    },
    startPath: '/student/services/incomplete-exam/new',
  },
  {
    id: 'program-change',
    name: 'Program Change',
    description:
      'Apply to move from your current program to another major or program.',
    keywords: 'program major transfer change switch',
    details: {
      description:
        "Apply to move from your current program to another program. You'll provide the college and program you want to move to and your reason for the change.",
      audience: 'Students who want to move from their current program to another program.',
      requirements:
        'You must choose a program different from your current one, and you can have only one Program Change request in progress at a time.',
      supportingDocuments: 'None.',
      steps: [
        'Select Start request on this page.',
        'Choose the college, then the program you want to move to.',
        'Explain your reason for the change.',
        'Submit your request.',
        'Track the status and decision in My Requests.',
      ],
      requiredDocuments: ['No documents are needed for this request.'],
      notes: [
        'You can apply again after your request has been decided.',
        'After an approved program change, you can request Course Equivalency for courses you have completed.',
        STATUS_NOTE,
      ],
      checklist: [
        'Know the college and program you want to move to.',
        'Check your CGPA and completed courses.',
        'Prepare a clear reason for your request.',
      ],
    },
    startPath: '/student/services/program-change/new',
  },
  {
    id: 'course-equivalency',
    name: 'Course Equivalency',
    description:
      'Request equivalency for a course that was not considered equivalent after your Program Change.',
    keywords: 'equivalency equivalent credit completed course new program change study plan',
    details: {
      description:
        'After your Program Change is approved, some courses from your previous program may be considered equivalent to courses in your new program. If a course was not considered equivalent, you can submit a Course Equivalency request to have it reviewed.',
      audience: 'Students who want to request equivalency for courses that were not considered equivalent after an approved Program Change.',
      requirements: 'You must have an approved Program Change request.',
      supportingDocuments: 'None.',
      steps: [
        'Select Start request on this page.',
        'Choose a course from your transcript with a recorded grade.',
        "Choose the course in your new program's study plan.",
        'Explain your reason.',
        'Submit, then track the status and decision in My Requests.',
      ],
      requiredDocuments: ['No documents are needed from you.'],
      notes: [
        'You can have only one request in progress for the same pair of courses.',
        'Submitting a request does not guarantee equivalency. The review compares the content of both courses using their syllabi and considers your grade and the credit hours.',
        STATUS_NOTE,
      ],
      checklist: [
        'Make sure your Program Change has been approved.',
        'Know which course from your transcript should count as which course in your new study plan.',
        'Prepare a clear reason for your request.',
      ],
    },
    startPath: '/student/services/course-equivalency/new',
  },
  {
    id: 'course-substitution',
    name: 'Course Substitution',
    description:
      'Request to replace a course in your study plan with another course.',
    keywords: 'substitution substitute replace course plan',
    details: {
      description:
        "Course Substitution allows you to request replacing a required course in your study plan with another course. You'll provide the course you want to replace, the course you want to take instead, and your reason.",
      audience: 'Students who want to replace a required course in their study plan with another course.',
      requirements:
        'The course you want to replace must be a required course in your study plan. You must not have passed or currently be enrolled in either course.',
      supportingDocuments: 'None.',
      steps: [
        'Select Start request on this page.',
        'Choose the Required course you want to replace.',
        'Choose the Elective course you want to take instead.',
        'Explain your reason.',
        'Submit, then track the status and decision in My Requests.',
      ],
      requiredDocuments: ['No documents are needed for this request.'],
      notes: [
        'Courses you have passed or are currently taking are not available for selection. Courses you have only failed may still be selected.',
        'You can have only one request in progress for the same original course.',
        STATUS_NOTE,
      ],
      checklist: [
        'Know the codes of the course you want to replace and the course you want to take instead.',
        'Prepare a clear reason for your request.',
      ],
    },
    startPath: '/student/services/course-substitution/new',
  },
]

// ---------------------------------------------------------------------------
// Services listed in the catalog but not offered yet (prototype v3). They
// follow the five real services, in the prototype's order, on both the
// student and the admin dashboard. They have no page, form or requests.

export interface FutureService {
  name: string
  /** Extra search words, matched along with the name. */
  keywords: string
  /** Outline icon path on the 48-unit grid. */
  icon: string
}

/** Card text of every service that is not offered yet. */
export const FUTURE_SERVICE_DESCRIPTION =
  'This service will be available in a future release.'

/** Shown when a not-yet-offered service is opened. */
export function notAvailableMessage(name: string) {
  return `${name} is not available yet. This request has not been implemented and is planned for a future release.`
}

// The prototype's icon for a future service, chosen from its name.
function futureIcon(name: string) {
  const n = name.toLowerCase()
  if (/graduat|ceremony/.test(n)) return 'M4 18l20-9 20 9-20 9zM12 22v9c0 3 5 6 12 6s12-3 12-6v-9M42 19v11'
  if (/letter|transcript|certificate|concern|documents/.test(n)) return 'M12 6h17l9 9v27H12zM29 6v9h9M18 24h14M18 30h14M18 36h8'
  if (/schedule|exam|midterm/.test(n)) return 'M8 10h32v30H8zM8 18h32M16 6v8M32 6v8M15 25h5M22 25h5M29 25h5M15 32h5M22 32h5'
  if (/withdraw|drop|cancel|underload/.test(n)) return 'M10 8h18v32H10zM28 24h14M36 18l6 6-6 6'
  return 'M8 14h32v24H8zM16 14V9h16v5M8 24h32'
}

const future = (name: string, keywords = ''): FutureService => ({
  name,
  keywords,
  icon: futureIcon(name),
})

export const futureServices: FutureService[] = [
  {
    name: 'Grade Change',
    keywords: 'grade mark result review correction',
    icon: 'M10 40h28M14 32l18-18 5 5-18 18h-5zM28 18l5 5M10 8h14M10 14h8',
  },
  future('Apply for Graduation', 'graduation graduate degree'),
  future('Attend Course in Hybrid Mode', 'hybrid online remote attendance'),
  future('Midterm Makeup Exam', 'midterm makeup exam missed'),
  future('Course Registration Outside UOS'),
  future("Dropping Courses without 'F' Grade"),
  future('Equivalency of Courses Transferred Within UOS'),
  future('Extra Chance for Academic Dismissed Student'),
  future('Official Transcript'),
  future('Petition for Reconsideration'),
  future('Reconsideration due to Medical Condition'),
  future('Register Underload'),
  future('To Whom it May Concern Letter'),
  future('Withdrawal from Semester'),
  future('Withdrawal from University'),
]

/** Cards shown before "Show more" on both dashboards. */
export const CATALOG_INITIAL_CARDS = 9

export function getAcademicRequest(
  id: string | undefined,
): AcademicRequestType | undefined {
  return academicRequestTypes.find((request) => request.id === id)
}

/** Element id of the Academic Requests section on the dashboard. */
export const CATALOG_ANCHOR_ID = 'academic-requests'

/** Route of a service's details page. */
export function serviceDetailsPath(id: AcademicRequestId) {
  return `/student/services/${id}`
}

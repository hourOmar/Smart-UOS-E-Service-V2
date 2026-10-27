// The five academic request services offered by Smart UoS E-Service, in the
// catalog order of the final prototype (Smart UoS E-Service v3.dc.html).
// Fixed application content. Raise Capacity's wording is taken verbatim
// from the approved prototype design (Smart UoS E-Service.dc.html, kept
// outside the project). The details-page content of the other four services
// is deliberately empty until the university supplies it: their pages keep
// every heading but show no text, and nothing here may be filled in with
// invented or placeholder wording.
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

// Details-page content not supplied yet.
const notYetProvided = (): AcademicRequestDetails => ({
  description: '',
  audience: '',
  requirements: '',
  supportingDocuments: '',
  steps: [],
  requiredDocuments: [],
  notes: [],
  checklist: [],
})

export const academicRequestTypes: AcademicRequestType[] = [
  {
    id: 'raise-capacity',
    name: 'Raise Capacity',
    description:
      'Request a seat in a course section that has reached its capacity.',
    keywords: 'seat section full capacity course register',
    details: {
      description:
        "Request a seat in a course section that has reached its capacity. You'll provide: the course, the section you want, and your reason for the request.",
      audience: 'Enrolled students who need a seat in a full course section.',
      requirements: 'Course prerequisites completed for the requested course.',
      supportingDocuments: 'No documents are requested in the current form.',
      steps: [
        'Select Start request on this page.',
        'Choose the course and the section you want.',
        'Explain why you need a seat in this section.',
        'Confirm the information and submit.',
        'Track the status and decision in My Requests.',
      ],
      requiredDocuments: [
        'No documents are requested in the current Raise Capacity form.',
      ],
      notes: ['Status updates and the decision appear in My Requests.'],
      checklist: [
        'Know the course code and section you want.',
        'Confirm the section is full in the registration system.',
        'Prepare a short, clear reason for the request.',
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
    details: notYetProvided(),
  },
  {
    id: 'program-change',
    name: 'Program Change',
    description:
      'Apply to move from your current program to another major or program.',
    keywords: 'program major transfer change switch',
    details: notYetProvided(),
    startPath: '/student/services/program-change/new',
  },
  {
    id: 'course-equivalency',
    name: 'Course Equivalency',
    description:
      'Request credit for a course you completed at another institution.',
    keywords: 'equivalency transfer credit exchange external',
    details: notYetProvided(),
  },
  {
    id: 'course-substitution',
    name: 'Course Substitution',
    description:
      'Request that another University of Sharjah course count in place of a course in your plan.',
    keywords: 'substitution substitute replace course plan',
    details: notYetProvided(),
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

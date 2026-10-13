// The five academic request services offered by Smart UoS E-Service.
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
    id: 'course-substitution',
    name: 'Course Substitution',
    description:
      'Request that another University of Sharjah course count in place of a course in your plan.',
    keywords: 'substitution substitute replace course plan',
    details: notYetProvided(),
  },
  {
    id: 'program-change',
    name: 'Program Change',
    description:
      'Apply to move from your current program to another major or program.',
    keywords: 'program major transfer change switch',
    details: notYetProvided(),
  },
  {
    id: 'course-equivalency',
    name: 'Course Equivalency',
    description:
      'Request credit for a course you completed at another institution.',
    keywords: 'equivalency transfer credit exchange external',
    details: notYetProvided(),
  },
]

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

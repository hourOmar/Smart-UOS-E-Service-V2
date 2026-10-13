import type { AcademicRequestId } from '../../data/academicRequests'

// The approved prototype's service icons (48-unit grid, 1.8 stroke).
// Course Substitution is not in the prototype: two courses with swap
// arrows, drawn on the same grid and stroke.
const ICON_PATHS: Record<AcademicRequestId, string> = {
  'raise-capacity': 'M8 40V18L24 8l16 10v22M8 40h32M19 40V29h10v11M24 14v8M20 18h8',
  'incomplete-exam': 'M12 6h17l9 9v27H12zM29 6v9h9M18 24h14M18 30h14M18 36h8',
  'course-substitution':
    'M6 8h16v12H6zM26 28h16v12H26zM28 12h6a4 4 0 0 1 4 4v6l-3-3M38 22l3-3M20 36h-6a4 4 0 0 1-4-4v-6l-3 3M10 26l3 3',
  'program-change': 'M8 16h28l-7-7M40 32H12l7 7M14 6v4M34 38v4',
  'course-equivalency':
    'M6 12h14v24H6zM28 12h14v24H28zM20 24h8M10 18h6M10 23h6M32 18h6M32 23h6',
}

interface RequestIconProps {
  id: AcademicRequestId
}

function RequestIcon({ id }: RequestIconProps) {
  return (
    <svg
      className="student-service__icon"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[id]} />
    </svg>
  )
}

export default RequestIcon

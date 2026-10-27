import type { AcademicRequestId } from '../../data/academicRequests'

// The approved prototype's service icons (48-unit grid, 1.8 stroke).
const ICON_PATHS: Record<AcademicRequestId, string> = {
  'raise-capacity': 'M8 40V18L24 8l16 10v22M8 40h32M19 40V29h10v11M24 14v8M20 18h8',
  'incomplete-exam': 'M12 6h17l9 9v27H12zM29 6v9h9M18 24h14M18 30h14M18 36h8',
  'course-substitution': 'M8 16h30l-7-7M40 32H10l7 7',
  'program-change': 'M8 16h28l-7-7M40 32H12l7 7M14 6v4M34 38v4',
  'course-equivalency':
    'M6 12h14v24H6zM28 12h14v24H28zM20 24h8M10 18h6M10 23h6M32 18h6M32 23h6',
}

// A real service by id, or a not-yet-offered service by its own path.
type RequestIconProps = { id: AcademicRequestId } | { path: string }

function RequestIcon(props: RequestIconProps) {
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
      <path d={'path' in props ? props.path : ICON_PATHS[props.id]} />
    </svg>
  )
}

export default RequestIcon

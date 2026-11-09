import { statusLabel } from '../../utils/statusLabels'

interface RequestStatusBadgeProps {
  status: string
  /** The request's type; Raise Capacity and Program Change show 'Completed' as 'Approved'. */
  requestType?: string | null
  /** A matching approval decision record is known to exist (Incomplete Exam shows 'Approved' only then). */
  approvalRecorded?: boolean
}

// Status pill in the prototype's colours: in progress (amber ◐),
// completed / approved (green ✓), rejected (red ✕). The colour follows the
// stored status; the label comes from statusLabel.
const STATUS_STYLE: Record<string, { glyph: string; tone: string }> = {
  'In Progress': { glyph: '◐', tone: 'progress' },
  Completed: { glyph: '✓', tone: 'completed' },
  Rejected: { glyph: '✕', tone: 'rejected' },
}

function RequestStatusBadge({ status, requestType, approvalRecorded = false }: RequestStatusBadgeProps) {
  const style = STATUS_STYLE[status] ?? { glyph: '○', tone: 'other' }

  return (
    <span className="req-status" data-tone={style.tone}>
      <span aria-hidden="true">{style.glyph}</span>
      {statusLabel(status, requestType, approvalRecorded)}
    </span>
  )
}

export default RequestStatusBadge

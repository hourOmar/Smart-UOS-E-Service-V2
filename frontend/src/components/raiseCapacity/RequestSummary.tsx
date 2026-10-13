import type { RaiseCapacitySection } from '../../services/raiseCapacity'
import { seatStatus } from '../../utils/sectionCapacity'

interface RequestSummaryProps {
  section: RaiseCapacitySection | null
  justification: string
}

// Live summary of what the student has chosen and entered.
function RequestSummary({ section, justification }: RequestSummaryProps) {
  const length = justification.trim().length

  const rows: { label: string; value: string; empty: boolean }[] = [
    { label: 'Request type', value: 'Raise Capacity', empty: false },
    {
      label: 'Course',
      value: section ? `${section.courseId} ${section.courseName}` : 'Not selected',
      empty: !section,
    },
    {
      label: 'Section and semester',
      value: section ? `Section ${section.sectionId} · ${section.term}` : 'Not selected',
      empty: !section,
    },
    {
      label: 'Current seats',
      value: section
        ? `${section.currentCapacity} / ${section.totalCapacity}${
            seatStatus(section.currentCapacity, section.totalCapacity).full
              ? ' (full)'
              : ''
          }`
        : '—',
      empty: !section,
    },
    {
      label: 'Justification',
      value: length ? `${length} ${length === 1 ? 'character' : 'characters'}` : 'Not provided',
      empty: !length,
    },
  ]

  return (
    <div className="rc-summary">
      <h3 className="rc-summary__title">Request Summary</h3>
      <dl className="rc-summary__list">
        {rows.map((row) => (
          <div key={row.label} className="rc-summary__row">
            <dt>{row.label}</dt>
            <dd data-empty={row.empty}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export default RequestSummary

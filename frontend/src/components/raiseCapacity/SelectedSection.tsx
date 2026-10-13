import type { RaiseCapacitySection } from '../../services/raiseCapacity'
import { seatStatus } from '../../utils/sectionCapacity'

interface SelectedSectionProps {
  section: RaiseCapacitySection | null
}

// Right column, top: a prompt until a section is chosen, then its details.
function SelectedSection({ section }: SelectedSectionProps) {
  if (!section) {
    return (
      <div className="rc-prompt">
        <span className="rc-prompt__step" aria-hidden="true">
          1
        </span>
        <div className="rc-prompt__text">
          <span className="rc-prompt__title">
            Select a course section to begin
          </span>
          <span>
            Choose the section you need from the list. Its details will appear
            here.
          </span>
        </div>
      </div>
    )
  }

  const seats = seatStatus(section.currentCapacity, section.totalCapacity)

  return (
    <div className="rc-selected" aria-live="polite">
      <div className="rc-selected__info">
        <span className="rc-selected__label">Selected section</span>
        <span className="rc-selected__title">
          {section.courseId} · {section.courseName}
        </span>
        <span className="rc-selected__meta">
          Section {section.sectionId} · {section.term}
        </span>
      </div>
      <span className="rc-selected__seats">
        <span className="rc-selected__count">
          {section.currentCapacity} / {section.totalCapacity}
        </span>
        <span className="rc-selected__status" data-full={seats.full}>
          {seats.label}
        </span>
      </span>
    </div>
  )
}

export default SelectedSection

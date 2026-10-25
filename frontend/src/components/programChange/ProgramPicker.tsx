import { isSameProgram, type CurrentProgram, type Program } from '../../services/programChange'
import { CapIcon } from './CurrentProgramCard'

interface ProgramPickerProps {
  collegeName: string
  programs: Program[]
  current: CurrentProgram
  selectedKey: string | null
  onSelect: (program: Program) => void
}

// Step 2: the selected college's programs. The student's exact current
// program (same Program_ID and Program_Name) is shown but cannot be chosen.
function ProgramPicker({ collegeName, programs, current, selectedKey, onSelect }: ProgramPickerProps) {
  const choosable = programs.filter((program) => !isSameProgram(program, current))

  return (
    <section className="pc-step" aria-labelledby="pc-program-title">
      <div className="pc-step__head">
        <h2 id="pc-program-title" className="pc-step__title">Available programs</h2>
      </div>
      {choosable.length === 0 ? (
        <p className="pc-state" role="status">
          This college has no other program to change to.
        </p>
      ) : null}
      <div className="pc-cards pc-cards--programs" role="radiogroup" aria-labelledby="pc-program-title">
        {programs.map((program, index) => {
          const isCurrent = isSameProgram(program, current)
          const selected = program.key === selectedKey
          const tagId = `pc-program-tag-${index}`
          return (
            <label
              key={program.key}
              className="pc-card pc-program"
              data-selected={selected}
              data-current={isCurrent}
            >
              <input
                type="radio"
                name="pc-program"
                className="student-visually-hidden"
                value={program.key}
                checked={selected}
                disabled={isCurrent}
                aria-describedby={isCurrent || selected ? tagId : undefined}
                onChange={() => onSelect(program)}
              />
              <span className="pc-program__top">
                <span className="pc-program__college">{collegeName}</span>
                {isCurrent && (
                  <span id={tagId} className="pc-tag pc-tag--current">Current program</span>
                )}
                {selected && !isCurrent && (
                  <span id={tagId} className="pc-tag pc-tag--selected">Selected program ✓</span>
                )}
              </span>
              <span className="pc-program__body">
                <span className="pc-program__icon" aria-hidden="true">
                  <CapIcon size={24} />
                </span>
                <span className="pc-program__text">
                  <span className="pc-program__name">{program.programName}</span>
                  <span className="pc-program__id">Program ID {program.programId}</span>
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </section>
  )
}

export default ProgramPicker

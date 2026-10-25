import type { CurrentProgram } from '../../services/programChange'

interface CurrentProgramCardProps {
  current: CurrentProgram
}

const NOT_RECORDED = 'Not recorded'

// The student's current program, college, CGPA and completed credits, as
// stored in their own Student record.
function CurrentProgramCard({ current }: CurrentProgramCardProps) {
  return (
    <section className="pc-current" aria-label="Current program">
      <span className="pc-current__icon" aria-hidden="true">
        <CapIcon size={30} />
      </span>
      <div className="pc-current__program">
        <span className="pc-current__label">Current enrolled program</span>
        <span className="pc-current__name">{current.programName ?? NOT_RECORDED}</span>
        {current.collegeName && <span className="pc-current__college">{current.collegeName}</span>}
      </div>
      <dl className="pc-current__stats">
        <div>
          <dt>Cumulative GPA</dt>
          <dd>{current.cgpa ?? NOT_RECORDED}</dd>
        </div>
        <div>
          <dt>Completed credits</dt>
          <dd>{current.completedHours ?? NOT_RECORDED}</dd>
        </div>
      </dl>
    </section>
  )
}

export function CapIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 9 12 4.5 21.5 9 12 13.5zM6.5 11v4.5c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3V11" />
    </svg>
  )
}

export default CurrentProgramCard

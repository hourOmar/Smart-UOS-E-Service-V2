import type { College } from '../../services/programChange'

interface CollegePickerProps {
  colleges: College[]
  selectedName: string | null
  onSelect: (name: string) => void
}

// Step 1: one card per college in public."Program", with its program count.
// Native radio inputs keep the cards keyboard- and screen-reader-friendly.
function CollegePicker({ colleges, selectedName, onSelect }: CollegePickerProps) {
  return (
    <section className="pc-step" aria-labelledby="pc-college-title">
      <div className="pc-step__head">
        <h2 id="pc-college-title" className="pc-step__title">1. Select target college</h2>
        <p className="pc-step__text">Choose a college to see its programs.</p>
      </div>
      <div className="pc-cards pc-cards--colleges" role="radiogroup" aria-labelledby="pc-college-title">
        {colleges.map((college) => {
          const selected = college.name === selectedName
          const count = college.programs.length
          return (
            <label key={college.name} className="pc-card pc-college" data-selected={selected}>
              <input
                type="radio"
                name="pc-college"
                className="student-visually-hidden"
                value={college.name}
                checked={selected}
                onChange={() => onSelect(college.name)}
              />
              <span className="pc-college__top">
                <span className="pc-college__name">{college.name}</span>
                {selected && <span className="pc-check" aria-hidden="true">✓</span>}
              </span>
              <span className="pc-college__foot">
                <span className="pc-college__count">{count === 1 ? '1 program' : `${count} programs`}</span>
                <span className="pc-college__action" aria-hidden="true">
                  {selected ? 'Selected' : 'View programs →'}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </section>
  )
}

export default CollegePicker

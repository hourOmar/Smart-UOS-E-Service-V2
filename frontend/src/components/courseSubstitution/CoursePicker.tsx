import { useState } from 'react'
import { courseLabel, filterCourses, type CourseOption } from '../../utils/courseSubstitutionSubmission'

// At most this many matches are listed; the student narrows the search for more.
const MAX_SHOWN = 50

interface CoursePickerProps {
  /** Unique prefix for element ids, e.g. 'csf-original'. */
  id: string
  label: string
  hint: string
  courses: CourseOption[]
  selectedId: string | null
  /** A course that cannot be chosen here (the other picker's choice). */
  excludedId?: string | null
  onSelect: (courseId: string) => void
  /** Shown once the student has tried to submit. */
  error: string | null
  disabled: boolean
}

// A searchable single choice from public."Course": type part of a course ID
// or name, then choose one of the matching courses.
function CoursePicker({ id, label, hint, courses, selectedId, excludedId, onSelect, error, disabled }: CoursePickerProps) {
  const [query, setQuery] = useState('')
  const choosable = courses.filter((course) => course.id !== excludedId)
  const matches = filterCourses(choosable, query)
  const shown = matches.slice(0, MAX_SHOWN)
  const selected = courses.find((course) => course.id === selectedId) ?? null
  const describedBy = [`${id}-hint`, error ? `${id}-error` : ''].filter(Boolean).join(' ')

  return (
    <fieldset className="rc-field csf-picker" aria-describedby={describedBy} disabled={disabled}>
      <legend className="rc-field__label">
        {label} <span className="rc-field__required" aria-hidden="true">*</span>
        <span className="student-visually-hidden">(required)</span>
      </legend>
      <span id={`${id}-hint`} className="csf-picker__hint">
        {hint}
      </span>

      <div className="csf-picker__selected" aria-live="polite">
        {selected ? (
          <>
            <span className="csf-picker__selected-label">Selected</span>
            <span className="csf-picker__selected-name">{courseLabel(selected)}</span>
          </>
        ) : (
          <span className="csf-picker__selected-empty">No course selected yet.</span>
        )}
      </div>

      <label htmlFor={`${id}-search`} className="student-visually-hidden">
        Search {label.toLowerCase()} by course ID or name
      </label>
      <input
        id={`${id}-search`}
        type="search"
        className="rc-field__input csf-picker__search"
        placeholder="Search by course ID or name"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
      />

      {shown.length === 0 ? (
        <p className="csf-picker__empty" role="status">
          No course matches “{query.trim()}”.
        </p>
      ) : (
        <div className="csf-picker__list" role="radiogroup" aria-label={label}>
          {shown.map((course) => (
            <label key={course.id} className="csf-option" data-selected={course.id === selectedId}>
              <input
                type="radio"
                name={`${id}-course`}
                value={course.id}
                checked={course.id === selectedId}
                onChange={() => onSelect(course.id)}
              />
              <span className="csf-option__id">{course.id}</span>
              <span className="csf-option__name">{course.name ?? 'Name not recorded'}</span>
              {course.creditHours != null && <span className="csf-option__hours">{course.creditHours} cr</span>}
            </label>
          ))}
        </div>
      )}
      {matches.length > shown.length && (
        <span className="csf-picker__more" role="status">
          Showing {shown.length} of {matches.length} courses. Type more of the ID or name to narrow the list.
        </span>
      )}

      {error && (
        <span id={`${id}-error`} className="rc-error">
          <span aria-hidden="true">✕ </span>
          {error}
        </span>
      )}
    </fieldset>
  )
}

export default CoursePicker

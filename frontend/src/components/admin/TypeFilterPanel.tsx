import type { TypeFilterOptions } from '../../services/adminRequests'
import {
  PRIORITY_FILTERS,
  PRIORITY_FILTER_LABELS,
  requestedSections,
  termOptions,
  validTerm,
  type PriorityFilter,
} from '../../utils/adminAllRequests'
import { typeFilterCount, typeFilterFields, type TypeFilters } from '../../utils/adminTypeFilters'
import CourseCombobox from '../courseEquivalency/CourseCombobox'
import '../../pages/RaiseCapacityForm.css'
import './TypeFilterPanel.css'

interface TypeFilterPanelProps {
  id: string
  type: string
  filters: TypeFilters
  onChange: (patch: Partial<TypeFilters>) => void
  onClear: () => void
  optionsStatus: 'loading' | 'ready' | 'error'
  options: TypeFilterOptions | null
  onRetryOptions: () => void
}

// The additional filters of one request type (shown under "Filters"): only
// the controls that type has. Every change applies immediately; Clear filters
// clears these filters only (not the status tab or the search).
function TypeFilterPanel({ id, type, filters, onChange, onClear, optionsStatus, options, onRetryOptions }: TypeFilterPanelProps) {
  const fields = typeFilterFields(type)
  const ready = optionsStatus === 'ready'
  const placeholder = (what: string) => (optionsStatus === 'loading' ? 'Loading…' : `Search ${what}`)
  const terms = termOptions(filters.term !== null ? [...(options?.terms ?? []), filters.term] : (options?.terms ?? []))
  const sections = requestedSections(options?.raiseCapacityTargets ?? [], filters.course)
  const count = typeFilterCount(type, filters)


  return (
    <div id={id} className="tfp" role="group" aria-label={`${type} filters`}>
      {optionsStatus === 'error' && (
        <p className="tfp-error" role="alert">
          Filter options couldn’t load.{' '}
          <button type="button" className="tfp-link" onClick={onRetryOptions}>
            Try again
          </button>
        </p>
      )}

      <div className="tfp-fields">
        {fields.priority && (
          <div className="tfp-field">
            <label htmlFor={`${id}-priority`}>Priority</label>
            <select
              id={`${id}-priority`}
              value={filters.priority ?? ''}
              onChange={(event) => onChange({ priority: (event.target.value || null) as PriorityFilter | null })}
            >
              <option value="">All priorities</option>
              {PRIORITY_FILTERS.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_FILTER_LABELS[priority]}
                </option>
              ))}
            </select>
          </div>
        )}

        {fields.course && (
          <div className="tfp-combo">
            <CourseCombobox
              id={`${id}-course`}
              label="Course"
              placeholder={placeholder('course ID or name')}
              courses={options?.courses ?? []}
              selectedId={filters.course}
              onSelect={(course) => onChange({ course })}
              error={null}
              disabled={!ready}
              required={false}
            />
            {filters.course && (
              <button type="button" className="tfp-link" onClick={() => onChange({ course: null })}>
                Clear course
              </button>
            )}
          </div>
        )}

        {fields.section && (
          <div className="tfp-field">
            <label htmlFor={`${id}-section`}>Section</label>
            <select
              id={`${id}-section`}
              value={filters.section ?? ''}
              disabled={!filters.course}
              onChange={(event) => onChange({ section: event.target.value || null })}
            >
              <option value="">All sections</option>
              {sections.map((section) => (
                <option key={section.value} value={section.value}>
                  {section.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {fields.term && (
          <div className="tfp-field">
            <label htmlFor={`${id}-term`}>Academic term</label>
            <select
              id={`${id}-term`}
              value={filters.term ?? ''}
              onChange={(event) => onChange({ term: validTerm(event.target.value) })}
            >
              <option value="">All terms</option>
              {terms.map((term) => (
                <option key={term.value} value={term.value}>
                  {term.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="tfp-actions">
        <button type="button" className="tfp-clear" onClick={onClear} disabled={count === 0}>
          Clear filters
        </button>
      </div>
    </div>
  )
}

export default TypeFilterPanel

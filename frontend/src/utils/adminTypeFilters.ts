// Additional filters of the per-type admin request lists
// (/admin/requests/:typeId), next to the status tabs and the search: Raise
// Capacity (priority, course, section, term) and Incomplete Exam (course,
// term). The other types have none. Each type filters on its own detail
// table, in the database (services/adminRequests.ts fetchTypeRequests). Kept
// free of network imports so it can be tested on its own
// (tests/adminTypeFilters.test.ts).
import {
  INCOMPLETE_EXAM,
  PRIORITY_FILTER_LABELS,
  RAISE_CAPACITY,
  termLabel,
  type PriorityFilter,
} from './adminAllRequests.ts'

export interface TypeFilters {
  /** Raise Capacity: saved priority level, or NOT_ASSESSED. */
  priority: PriorityFilter | null
  /** Raise Capacity / Incomplete Exam: the requested course. */
  course: string | null
  /** Raise Capacity: the requested section (needs a course). */
  section: string | null
  /** Raise Capacity / Incomplete Exam: the stored term (YYYY01/02/03). */
  term: number | null
}

export const EMPTY_TYPE_FILTERS: TypeFilters = {
  priority: null,
  course: null,
  section: null,
  term: null,
}

/** Which filters a type offers. */
export function typeFilterFields(type: string) {
  return {
    priority: type === RAISE_CAPACITY,
    course: type === RAISE_CAPACITY || type === INCOMPLETE_EXAM,
    section: type === RAISE_CAPACITY,
    term: type === RAISE_CAPACITY || type === INCOMPLETE_EXAM,
  }
}

/** Whether the type's list shows the Filters button at all. */
export function typeHasFilters(type: string): boolean {
  return Object.values(typeFilterFields(type)).some(Boolean)
}

/** One equality condition on the type's detail table. */
export interface DetailCondition {
  column: string
  value: string | number
}

/** The detail-table conditions for the type's filters (only the fields the
 *  type has; values of other types are ignored). */
export function typeDetailConditions(type: string, f: TypeFilters): DetailCondition[] {
  const fields = typeFilterFields(type)
  const out: DetailCondition[] = []
  if (fields.course && f.course) out.push({ column: 'Course_ID', value: f.course })
  if (fields.section && f.course && f.section) out.push({ column: 'Section_ID', value: f.section })
  if (fields.term && f.term !== null) out.push({ column: 'Term', value: f.term })
  return out
}

/** The filters after a change: a new or cleared course clears the section. */
export function patchTypeFilters(current: TypeFilters, patch: Partial<TypeFilters>): TypeFilters {
  const next = { ...current, ...patch }
  if ('course' in patch && patch.course !== current.course && !('section' in patch)) next.section = null
  if (!next.course) next.section = null
  return next
}

/** How many additional filters are set (for the Filters button). */
export function typeFilterCount(type: string, f: TypeFilters): number {
  const fields = typeFilterFields(type)
  return [
    fields.priority && f.priority,
    fields.course && f.course,
    fields.section && f.course && f.section,
    fields.term && f.term !== null,
  ].filter(Boolean).length
}

export interface TypeFilterChip {
  key: keyof TypeFilters
  label: string
  remove: Partial<TypeFilters>
}

/** One removable chip per active additional filter. */
export function typeFilterChips(type: string, f: TypeFilters): TypeFilterChip[] {
  const fields = typeFilterFields(type)
  const chips: TypeFilterChip[] = []
  if (fields.priority && f.priority) {
    chips.push({ key: 'priority', label: `${PRIORITY_FILTER_LABELS[f.priority]} Priority`, remove: { priority: null } })
  }
  if (fields.course && f.course) chips.push({ key: 'course', label: `Course ${f.course}`, remove: { course: null, section: null } })
  if (fields.section && f.course && f.section) chips.push({ key: 'section', label: `Section ${f.section}`, remove: { section: null } })
  if (fields.term && f.term !== null) chips.push({ key: 'term', label: termLabel(f.term), remove: { term: null } })
  return chips
}

// Pure helpers for the Course Equivalency course dropdowns (CourseCombobox).
import { filterCourses, type CourseOption } from './courseSubstitutionSubmission.ts'

/** The courses listed for a search: every course except the excluded one (the
 *  other dropdown's choice), matched by course ID or name (case-insensitive). */
export function comboboxCourses(
  courses: readonly CourseOption[],
  query: string,
  excludedId?: string | null,
): CourseOption[] {
  return filterCourses(
    courses.filter((course) => course.id !== excludedId),
    query,
  )
}

/** The highlighted option after a navigation key (wraps around; -1 = none). */
export function nextActiveIndex(current: number, key: string, count: number): number {
  if (count <= 0) return -1
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count
    case 'ArrowUp':
      return current <= 0 ? count - 1 : current - 1
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return Math.min(current, count - 1)
  }
}

/** "3 credit hours", "1 credit hour"; null when not recorded. */
export function creditHoursLabel(hours: number | null | undefined): string | null {
  if (hours == null) return null
  return `${hours} credit ${hours === 1 ? 'hour' : 'hours'}`
}

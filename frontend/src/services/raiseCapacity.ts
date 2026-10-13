import { supabase } from './supabase'
import { CURRENT_TERM } from '../config/academicTerm'

// A course section a student can choose in the Raise Capacity form.
// Sections are identified by their full primary key:
// Course_ID + Section_ID + Term (Section_ID alone repeats across courses).
export interface RaiseCapacitySection {
  key: string
  courseId: string
  courseName: string
  sectionId: string
  term: string
  currentCapacity: number
  totalCapacity: number
}

interface SectionRow {
  Course_ID: string | number
  Section_ID: string | number
  Term: string | number
  Current_Capacity: number
  Total_Capacity: number
  Course: { Course_Name: string } | { Course_Name: string }[] | null
}

export function sectionKey(courseId: string, sectionId: string, term: string) {
  return JSON.stringify([courseId, sectionId, term])
}

// Why a submission was refused. The first six are the messages raised by
// public.submit_raise_capacity_request; the last two come from the API.
export type SubmitErrorCode =
  | 'not_registered_student'
  | 'reason_required'
  | 'reason_too_long'
  | 'section_not_found'
  | 'already_enrolled'
  | 'duplicate_request'
  | 'signed_out'
  | 'unknown'

const SERVER_CODES: ReadonlySet<SubmitErrorCode> = new Set([
  'not_registered_student',
  'reason_required',
  'reason_too_long',
  'section_not_found',
  'already_enrolled',
  'duplicate_request',
])

const SUBMIT_ERROR_MESSAGES: Record<SubmitErrorCode, string> = {
  not_registered_student:
    'This account is not registered as a student, so the request cannot be submitted.',
  reason_required: 'Enter a justification for your request.',
  reason_too_long: 'The justification can be at most 1000 characters.',
  section_not_found:
    'This section is no longer available. Select another section.',
  already_enrolled: 'You are already registered in this section.',
  duplicate_request:
    'You already have a Raise Capacity request in progress for this section.',
  signed_out: 'Your session has ended. Sign in again, then submit your request.',
  unknown:
    'We couldn’t submit your request. Check your connection and try again.',
}

export class RaiseCapacitySubmitError extends Error {
  readonly code: SubmitErrorCode

  constructor(code: SubmitErrorCode) {
    super(SUBMIT_ERROR_MESSAGES[code])
    this.name = 'RaiseCapacitySubmitError'
    this.code = code
  }
}

function submitErrorCode(error: { message?: string; code?: string }): SubmitErrorCode {
  const message = error.message ?? ''
  if (SERVER_CODES.has(message as SubmitErrorCode)) return message as SubmitErrorCode
  // Expired/missing session: PostgREST rejects the token, or the request
  // arrives as anon, which may not execute the function.
  if (error.code === 'PGRST301' || /jwt/i.test(message) || message.startsWith('permission denied')) {
    return 'signed_out'
  }
  return 'unknown'
}

// Saves the request through public.submit_raise_capacity_request, which
// identifies the student from the signed-in account and writes Request and
// Raise_Capacity together. Returns the new Request_ID.
export async function submitRaiseCapacityRequest(
  section: RaiseCapacitySection,
  justification: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('submit_raise_capacity_request', {
    p_course_id: section.courseId,
    p_section_id: section.sectionId,
    p_term: Number(section.term),
    p_reason: justification,
  })

  if (error) throw new RaiseCapacitySubmitError(submitErrorCode(error))
  if (typeof data !== 'string' || data === '') {
    throw new RaiseCapacitySubmitError('unknown')
  }
  return data
}

// Reads every section of the current term (full and open) with its course
// name. Additional_Capacity is intentionally not selected: it is never shown
// or counted on student pages.
export async function fetchRaiseCapacitySections(): Promise<RaiseCapacitySection[]> {
  const { data, error } = await supabase
    .from('Section')
    .select(
      'Course_ID, Section_ID, Term, Current_Capacity, Total_Capacity, Course(Course_Name)',
    )
    .eq('Term', CURRENT_TERM)
    .order('Course_ID')
    .order('Section_ID')

  if (error) throw error

  return ((data ?? []) as SectionRow[]).map((row) => {
    const course = Array.isArray(row.Course) ? row.Course[0] : row.Course
    const courseId = String(row.Course_ID)
    const sectionId = String(row.Section_ID)
    const term = String(row.Term)

    return {
      key: sectionKey(courseId, sectionId, term),
      courseId,
      courseName: course?.Course_Name ?? '',
      sectionId,
      term,
      currentCapacity: Number(row.Current_Capacity),
      totalCapacity: Number(row.Total_Capacity),
    }
  })
}

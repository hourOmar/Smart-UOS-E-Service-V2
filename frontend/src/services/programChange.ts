import { supabase } from './supabase'

// Data for the student Program Change form, read with the signed-in
// student's own session (no submission yet).
// - Programs, with their colleges, come from public."Program" exactly as
//   stored. A program is identified by Program_ID AND Program_Name together:
//   several programs share one Program_ID.
// - The current program comes from the student's own Student row, found by
//   the account's Auth_User_ID (the database policies return only that row).

export interface Program {
  /** Program_ID + Program_Name, the program's identity. */
  key: string
  programId: string
  programName: string
  collegeName: string
}

export interface College {
  name: string
  programs: Program[]
}

export interface CurrentProgram {
  programId: string | null
  programName: string | null
  collegeName: string | null
  cgpa: string | null
  completedHours: string | null
}

interface ProgramRow {
  Program_ID: string | null
  Program_Name: string | null
  College_Name: string | null
}

interface StudentProgramRow {
  Program_ID: string | null
  Program_Name: string | null
  CGPA: number | null
  Completed_Hours: number | null
  Program: { College_Name: string | null } | { College_Name: string | null }[] | null
}

/** Values exactly as stored; only empty strings become null. */
const value = (raw: unknown) => {
  const text = raw == null ? '' : String(raw)
  return text.trim() === '' ? null : text
}

export const REASON_MIN_LENGTH = 20
export const REASON_MAX_LENGTH = 1000

/** The prototype's wording; null when the reason is acceptable. The maximum
 *  is enforced by the field itself (maxLength). */
export function reasonError(reason: string): string | null {
  const length = reason.trim().length
  if (!length) return 'Explain why you want to change program.'
  if (length < REASON_MIN_LENGTH) {
    return `Add a little more detail (at least ${REASON_MIN_LENGTH} characters).`
  }
  return null
}

export function programKey(programId: string, programName: string) {
  return JSON.stringify([programId, programName])
}

export function isSameProgram(program: Program, current: CurrentProgram | null) {
  return (
    current !== null &&
    program.programId === current.programId &&
    program.programName === current.programName
  )
}

/** Every program, grouped by college, colleges and programs in name order. */
export async function fetchColleges(): Promise<College[]> {
  const { data, error } = await supabase
    .from('Program')
    .select('Program_ID, Program_Name, College_Name')
  if (error) throw error

  const byCollege = new Map<string, Program[]>()
  for (const row of (data ?? []) as ProgramRow[]) {
    const programId = value(row.Program_ID)
    const programName = value(row.Program_Name)
    const collegeName = value(row.College_Name)
    if (!programId || !programName || !collegeName) continue
    const programs = byCollege.get(collegeName) ?? []
    programs.push({ key: programKey(programId, programName), programId, programName, collegeName })
    byCollege.set(collegeName, programs)
  }

  return [...byCollege.entries()]
    .map(([name, programs]) => ({
      name,
      programs: programs.sort((a, b) => a.programName.localeCompare(b.programName)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// Submission through public.submit_program_change_request, which identifies
// the student from the signed-in account, reads their current program from
// the database, and writes Request and Program_Change together.

// Why a submission was refused. The first eight are the messages raised by
// the database function; the last two come from the API.
export type ProgramChangeErrorCode =
  | 'not_registered_student'
  | 'reason_required'
  | 'reason_too_short'
  | 'reason_too_long'
  | 'current_program_missing'
  | 'program_not_found'
  | 'same_program'
  | 'duplicate_request'
  | 'signed_out'
  | 'unknown'

const SERVER_CODES: ReadonlySet<ProgramChangeErrorCode> = new Set([
  'not_registered_student',
  'reason_required',
  'reason_too_short',
  'reason_too_long',
  'current_program_missing',
  'program_not_found',
  'same_program',
  'duplicate_request',
])

const SUBMIT_ERROR_MESSAGES: Record<ProgramChangeErrorCode, string> = {
  not_registered_student:
    'This account is not registered as a student, so the request cannot be submitted.',
  reason_required: 'Explain why you want to change program.',
  reason_too_short: `Add a little more detail (at least ${REASON_MIN_LENGTH} characters).`,
  reason_too_long: `The reason can be at most ${REASON_MAX_LENGTH} characters.`,
  current_program_missing:
    'Your current program is not recorded correctly, so the request cannot be submitted. Contact the Registrar’s Office.',
  program_not_found: 'This program is no longer available. Select another program.',
  same_program: 'You are already enrolled in this program. Select a different program.',
  duplicate_request:
    'You already have a Program Change request in progress. You can submit a new one after it has been decided.',
  signed_out: 'Your session has ended. Sign in again, then submit your request.',
  unknown: 'We couldn’t submit your request. Check your connection and try again.',
}

export class ProgramChangeSubmitError extends Error {
  readonly code: ProgramChangeErrorCode

  constructor(code: ProgramChangeErrorCode) {
    super(SUBMIT_ERROR_MESSAGES[code])
    this.name = 'ProgramChangeSubmitError'
    this.code = code
  }
}

function submitErrorCode(error: { message?: string; code?: string }): ProgramChangeErrorCode {
  const message = error.message ?? ''
  if (SERVER_CODES.has(message as ProgramChangeErrorCode)) return message as ProgramChangeErrorCode
  // Expired/missing session: PostgREST rejects the token, or the request
  // arrives as anon, which may not execute the function.
  if (error.code === 'PGRST301' || /jwt/i.test(message) || message.startsWith('permission denied')) {
    return 'signed_out'
  }
  return 'unknown'
}

/** Saves the request; returns the new Request_ID. */
export async function submitProgramChangeRequest(program: Program, reason: string): Promise<string> {
  let result
  try {
    result = await supabase.rpc('submit_program_change_request', {
      p_new_program_id: program.programId,
      p_new_program_name: program.programName,
      p_reason: reason,
    })
  } catch {
    throw new ProgramChangeSubmitError('unknown')
  }
  const { data, error } = result
  if (error) throw new ProgramChangeSubmitError(submitErrorCode(error))
  if (typeof data !== 'string' || data === '') throw new ProgramChangeSubmitError('unknown')
  return data
}

/** The signed-in student's current program, or null when the account has
 *  no linked Student record. */
export async function fetchCurrentProgram(): Promise<CurrentProgram | null> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) return null

  const { data, error } = await supabase
    .from('Student')
    .select('Program_ID, Program_Name, CGPA, Completed_Hours, Program(College_Name)')
    .eq('Auth_User_ID', user.id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as unknown as StudentProgramRow
  const program = Array.isArray(row.Program) ? row.Program[0] : row.Program
  return {
    programId: value(row.Program_ID),
    programName: value(row.Program_Name),
    collegeName: value(program?.College_Name),
    cgpa: row.CGPA == null ? null : Number(row.CGPA).toFixed(2),
    completedHours: row.Completed_Hours == null ? null : String(row.Completed_Hours),
  }
}

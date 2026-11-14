// The admin home search: tells a student ID from a request ID by the formats
// the database uses, before anything is queried. Kept free of imports so it
// can be tested on its own (tests/adminStudentProfile.test.ts).
//
// Formats (as stored): students  U + 8 digits          e.g. U21100123
//                      requests  STUD_<code>_<code>_<6 digits>
//                                e.g. STUD_INCRQ_INC2_000075

export type SearchInput =
  | { kind: 'empty' }
  | { kind: 'invalid'; value: string }
  | { kind: 'student'; id: string }
  | { kind: 'request'; id: string }

const STUDENT_ID = /^U\d{8}$/
const REQUEST_ID = /^STUD_[A-Z0-9]+_[A-Z0-9]+_\d{6}$/

/** IDs are stored in upper case; the input is trimmed and upper-cased. */
export function classifySearchInput(raw: string): SearchInput {
  const value = raw.trim().toUpperCase()
  if (!value) return { kind: 'empty' }
  if (STUDENT_ID.test(value)) return { kind: 'student', id: value }
  if (REQUEST_ID.test(value)) return { kind: 'request', id: value }
  return { kind: 'invalid', value: raw.trim() }
}

/** An expired or missing session (the API rejects the token), as opposed to
 *  a connection or database failure. */
export function isSignedOutError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null
  return e?.code === 'PGRST301' || /jwt/i.test(typeof e?.message === 'string' ? e.message : '')
}

export const SEARCH_MESSAGES = {
  empty: 'Enter a student ID or a request ID.',
  invalid: 'Enter a student ID (for example U21100123) or a request ID (for example STUD_INCRQ_INC2_000075).',
  studentNotFound: (id: string) => `No student has the ID ${id}. Check the ID and try again.`,
  requestNotFound: (id: string) => `No request has the ID ${id}. Check the ID and try again.`,
  noReviewPage: (id: string, type: string) =>
    `${id} is a ${type} request. ${type} requests don’t have a review page yet.`,
  signedOut: 'Your session has ended. Sign in again to search.',
  failed: 'The search couldn’t be completed. Check your connection and try again.',
}

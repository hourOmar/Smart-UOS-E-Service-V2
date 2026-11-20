// The Program Change reason rule, kept free of network imports so it can be
// tested on its own (tests/reasonLength.test.ts). The database function
// submit_program_change_request enforces the same rule: required (not empty
// after trimming) and at most 1000 characters, with no minimum length.

export const REASON_MAX_LENGTH = 1000

/** Null when the reason is acceptable (counted after trimming). */
export function reasonError(reason: string): string | null {
  const length = reason.trim().length
  if (!length) return 'Explain why you want to change program.'
  if (length > REASON_MAX_LENGTH) return `The reason can be at most ${REASON_MAX_LENGTH} characters.`
  return null
}

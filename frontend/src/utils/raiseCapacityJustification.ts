// The Raise Capacity justification rule, kept free of network imports so it can
// be tested on its own (tests/reasonLength.test.ts). The database function
// submit_raise_capacity_request enforces the same rule: required (not empty
// after trimming) and at most 1000 characters, with no minimum length.

export const JUSTIFICATION_MAX_LENGTH = 1000

/** Null when the justification is acceptable (counted after trimming). */
export function justificationError(justification: string): string | null {
  const length = justification.trim().length
  if (!length) return 'Enter a justification for your request.'
  if (length > JUSTIFICATION_MAX_LENGTH) {
    return `The justification can be at most ${JUSTIFICATION_MAX_LENGTH} characters.`
  }
  return null
}

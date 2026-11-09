// The order of one Incomplete Exam submission, kept free of Supabase (the
// three calls are passed in) so it can be tested with `npm test`:
//
//   0 PDFs : submit(form, null, [])
//   1-5    : reserve once (or reuse a still-valid reservation for the same
//            exam) -> upload every file not yet uploaded into it, one at a
//            time -> ONLY if every file is uploaded: submit(form, id, paths)
//
// Guarantees:
//   - submit is never called while any selected file has failed or has not
//     been uploaded into the CURRENT reservation;
//   - a file that failed must be removed and selected again (it gets a new
//     name): a list that still contains a failed file is refused before any
//     call is made;
//   - a retry uploads only the files not yet in the current reservation;
//   - a Storage 409 "already exists" is ALWAYS a failure: an existing object
//     is never accepted as this file (a matching name, size and type do not
//     prove identity). The student removes and reselects the file, which
//     gives it a new random name;
//   - a new reservation (another exam, expired, or one the database
//     refused) resets every file to "pending", so all of them go to the
//     new folder;
//   - every result is a new value; nothing passed in is changed.

import {
  IncompleteExamSubmitError,
  MAX_PROOF_FILES,
  ProofUploadError,
  RESERVATION_RESET_CODES,
  examKey,
  proofPath,
  type ExamSelection,
  type IncompleteExamForm,
  type ProofUploadErrorCode,
  type SubmitErrorCode,
  type UploadReservationResult,
} from './incompleteExamSubmission.ts'

/** A reservation is not reused when it expires within this margin. */
export const RESERVATION_MARGIN_MS = 2 * 60 * 1000

export type ProofUploadStatus = 'pending' | 'uploading' | 'uploaded' | 'failed'

export interface ProofEntry<F = unknown> {
  /** Stable id for the UI list. */
  id: string
  file: F
  /** Safe storage name, fixed when the file was selected. */
  fileName: string
  status: ProofUploadStatus
  /** Set once uploaded: <uploadId>/<fileName>. */
  path: string | null
  error: ProofUploadErrorCode | null
}

export interface UploadReservation extends UploadReservationResult {
  /** examKey() of the exam it was reserved for. */
  examKey: string
}

export interface SubmissionDeps<F> {
  reserve: (exam: ExamSelection) => Promise<UploadReservationResult>
  /** Uploads one file to <uploadId>/<entry.fileName>; resolves to that path. */
  upload: (uploadId: string, entry: ProofEntry<F>) => Promise<string>
  submit: (form: IncompleteExamForm, uploadId: string | null, paths: string[]) => Promise<string>
  now: () => number
}

export type SubmissionOutcome<F> =
  | { kind: 'submitted'; requestId: string; entries: ProofEntry<F>[]; reservation: UploadReservation | null }
  | { kind: 'uploads_failed'; entries: ProofEntry<F>[]; reservation: UploadReservation | null }
  | { kind: 'refused'; code: SubmitErrorCode; entries: ProofEntry<F>[]; reservation: UploadReservation | null }

export interface SubmissionInput<F> {
  form: IncompleteExamForm
  entries: readonly ProofEntry<F>[]
  reservation: UploadReservation | null
  /** Called with the current list whenever a file's status changes. */
  onEntries?: (entries: ProofEntry<F>[]) => void
}

export function newProofEntry<F>(id: string, file: F, fileName: string): ProofEntry<F> {
  return { id, file, fileName, status: 'pending', path: null, error: null }
}

/** A reservation can be reused for this exam (same exam, not about to expire). */
export function reservationUsable(
  reservation: UploadReservation | null,
  exam: ExamSelection,
  nowMs: number,
): reservation is UploadReservation {
  return reservation !== null
    && reservation.examKey === examKey(exam)
    && Date.parse(reservation.expiresAt) - nowMs > RESERVATION_MARGIN_MS
}

/** Uploaded into THIS reservation (an upload into an older one does not count). */
export function isUploadedInto(entry: ProofEntry, uploadId: string): boolean {
  return entry.status === 'uploaded' && entry.path === proofPath(uploadId, entry.fileName)
}

export type SubmissionBlocker = 'failed_files' | 'uploading'

/** Why the files do not allow a submission attempt now (null = they do). */
export function submissionBlocker(entries: readonly ProofEntry[]): SubmissionBlocker | null {
  if (entries.some((e) => e.status === 'failed')) return 'failed_files'
  if (entries.some((e) => e.status === 'uploading')) return 'uploading'
  return null
}

/** True only when every entry is uploaded into the reservation (or there are none). */
export function readyToSubmit(entries: readonly ProofEntry[], reservation: UploadReservation | null): boolean {
  if (entries.length === 0) return true
  return reservation !== null && entries.every((e) => isUploadedInto(e, reservation.uploadId))
}

function resetEntry<F>(entry: ProofEntry<F>): ProofEntry<F> {
  return { ...entry, status: 'pending', path: null, error: null }
}

function codeOf(error: unknown): SubmitErrorCode {
  return error instanceof IncompleteExamSubmitError ? error.code : 'unknown'
}

export async function runIncompleteExamSubmission<F>(
  deps: SubmissionDeps<F>,
  input: SubmissionInput<F>,
): Promise<SubmissionOutcome<F>> {
  const { form } = input
  let entries: ProofEntry<F>[] = input.entries.map((e) => ({ ...e }))
  const publish = () => input.onEntries?.(entries.map((e) => ({ ...e })))

  // No documents: one call, no reservation.
  if (entries.length === 0) {
    try {
      const requestId = await deps.submit(form, null, [])
      return { kind: 'submitted', requestId, entries, reservation: null }
    } catch (error) {
      return { kind: 'refused', code: codeOf(error), entries, reservation: input.reservation }
    }
  }
  if (entries.length > MAX_PROOF_FILES) {
    return { kind: 'refused', code: 'too_many_proof_files', entries, reservation: input.reservation }
  }
  // A failed file must be removed and selected again first; nothing is sent.
  if (submissionBlocker(entries) !== null) {
    return { kind: 'uploads_failed', entries, reservation: input.reservation }
  }

  // A reservation for this exam.
  let reservation = input.reservation
  if (!reservationUsable(reservation, form, deps.now())) {
    try {
      const reserved = await deps.reserve(form)
      reservation = { ...reserved, examKey: examKey(form) }
    } catch (error) {
      return { kind: 'refused', code: codeOf(error), entries, reservation: null }
    }
    entries = entries.map(resetEntry)
    publish()
  }
  const current: UploadReservation = reservation

  // Upload what is not yet in this reservation, one file at a time.
  for (let i = 0; i < entries.length; i += 1) {
    if (isUploadedInto(entries[i], current.uploadId)) continue
    entries[i] = { ...entries[i], status: 'uploading', path: null, error: null }
    publish()
    try {
      const path = await deps.upload(current.uploadId, entries[i])
      entries[i] = { ...entries[i], status: 'uploaded', path, error: null }
    } catch (error) {
      // Every upload error, a 409 conflict included, is a failure.
      const code: ProofUploadErrorCode = error instanceof ProofUploadError ? error.code : 'upload_failed'
      entries[i] = { ...entries[i], status: 'failed', path: null, error: code }
    }
    publish()
  }

  // Never submit unless every selected file is in this reservation.
  if (!readyToSubmit(entries, current)) {
    return { kind: 'uploads_failed', entries, reservation: current }
  }

  try {
    const requestId = await deps.submit(form, current.uploadId, entries.map((e) => e.path as string))
    return { kind: 'submitted', requestId, entries, reservation: null }
  } catch (error) {
    const code = codeOf(error)
    if (RESERVATION_RESET_CODES.has(code)) {
      entries = entries.map(resetEntry)
      publish()
      return { kind: 'refused', code, entries, reservation: null }
    }
    return { kind: 'refused', code, entries, reservation: current }
  }
}

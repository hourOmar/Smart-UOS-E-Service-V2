// Rules of the admin Student Profile page, kept free of network imports so
// they can be tested on their own (tests/adminStudentProfile.test.ts).
// Nothing here recalculates official values: CGPA and completed hours come
// from the Student record as stored; statuses use statusLabel, the rule every
// other page uses.

import { statusLabel } from './statusLabels.ts'

// ---------------------------------------------------------------------------
// Transcript (Takes, with Course names and credit hours)

export interface TranscriptEntry {
  courseId: string
  courseName: string | null
  creditHours: number | null
  /** As stored, e.g. 202601. */
  term: number
  sectionId: string | null
  /** As stored; null when no grade has been recorded. */
  grade: string | null
}

export interface TranscriptCourse extends TranscriptEntry {
  /** The course appears more than once in the student's Takes rows. */
  repeated: boolean
}

export interface TranscriptTerm {
  term: number
  courses: TranscriptCourse[]
}

/** Every Takes row, grouped by term (most recent first), courses by code.
 *  Nothing is merged or dropped: a repeated course keeps every attempt. */
export function groupTranscript(entries: readonly TranscriptEntry[]): TranscriptTerm[] {
  const attempts = new Map<string, number>()
  for (const e of entries) attempts.set(e.courseId, (attempts.get(e.courseId) ?? 0) + 1)

  const byTerm = new Map<number, TranscriptCourse[]>()
  for (const e of entries) {
    const list = byTerm.get(e.term) ?? []
    list.push({ ...e, repeated: (attempts.get(e.courseId) ?? 0) > 1 })
    byTerm.set(e.term, list)
  }
  return [...byTerm.entries()]
    .sort(([a], [b]) => b - a)
    .map(([term, courses]) => ({
      term,
      courses: courses.sort(
        (a, b) => a.courseId.localeCompare(b.courseId) || (a.sectionId ?? '').localeCompare(b.sectionId ?? ''),
      ),
    }))
}

/** The semester name of a stored term, or null when the code is not one of
 *  the project's. Terms are the academic year's start plus a semester code:
 *  YYYY01 is Fall YYYY, YYYY02 is Spring of the next calendar year and YYYY03
 *  is Summer of the next calendar year, so 202601 → "Fall 2026", 202602 →
 *  "Spring 2027" and 202603 → "Summer 2027". */
export function knownTermName(term: number): string | null {
  if (!Number.isInteger(term) || term < 100000 || term > 999999) return null
  const year = Math.floor(term / 100)
  const code = term % 100
  if (code === 1) return `Fall ${year}`
  if (code === 2) return `Spring ${year + 1}`
  if (code === 3) return `Summer ${year + 1}`
  return null
}

/** A readable name for a stored term (see knownTermName); any other value is
 *  shown as stored ("Term 202605") rather than guessed. */
export function termName(term: number): string {
  return knownTermName(term) ?? `Term ${term}`
}

// ---------------------------------------------------------------------------
// Request history (every Request row of the student)

export interface HistoryRequest {
  id: string
  type: string
  /** Request_Date, YYYY-MM-DD. */
  date: string | null
  /** Submission_Time, HH:MM:SS. */
  time: string | null
  /** Current_Status as stored. */
  status: string
  /** A matching approval decision record exists (see statusLabel). */
  approvalRecorded: boolean
  /** Request_History completion date, once decided. */
  decidedAt: string | null
}

/** The label every other page shows for this request's status. */
export function historyStatusLabel(row: HistoryRequest): string {
  return statusLabel(row.status, row.type, row.approvalRecorded)
}

/** Newest first: submission date, then submission time, then request ID,
 *  all descending (a stable, total order). Requests without a date go last. */
export function sortRequestHistory<T extends HistoryRequest>(rows: readonly T[]): T[] {
  const desc = (a: string | null, b: string | null) => {
    if (a === b) return 0
    if (a === null) return 1
    if (b === null) return -1
    return a < b ? 1 : -1
  }
  return [...rows].sort((a, b) => desc(a.date, b.date) || desc(a.time, b.time) || desc(a.id, b.id))
}

export interface RequestSummary {
  total: number
  inProgress: number
  /** Shown as "Approved" by statusLabel (never a bare Completed). */
  approved: number
  rejected: number
  /** Completed requests without a recorded approval (Incomplete Exam,
   *  Course Substitution): in the total, never counted as approved. */
  completedUnconfirmed: number
}

export function summarizeRequests(rows: readonly HistoryRequest[]): RequestSummary {
  const summary: RequestSummary = { total: 0, inProgress: 0, approved: 0, rejected: 0, completedUnconfirmed: 0 }
  for (const row of rows) {
    summary.total += 1
    const label = historyStatusLabel(row)
    if (row.status === 'In Progress') summary.inProgress += 1
    else if (row.status === 'Rejected') summary.rejected += 1
    else if (label === 'Approved') summary.approved += 1
    else if (row.status === 'Completed') summary.completedUnconfirmed += 1
  }
  return summary
}

export interface HistoryFilter {
  /** Request_Type, or null for all. */
  type: string | null
  /** A status label (In Progress, Approved, Completed, Rejected), or null for all. */
  status: string | null
  /** Part of a request ID. */
  query: string
}

/** Filters keep the chronological order of the rows they are given. */
export function filterRequestHistory<T extends HistoryRequest>(rows: readonly T[], filter: HistoryFilter): T[] {
  const q = filter.query.trim().toUpperCase()
  return rows.filter(
    (row) =>
      (filter.type === null || row.type === filter.type) &&
      (filter.status === null || historyStatusLabel(row) === filter.status) &&
      (q === '' || row.id.toUpperCase().includes(q)),
  )
}

/** The status labels present, in a fixed order, for the status filter. */
export function historyStatusOptions(rows: readonly HistoryRequest[]): string[] {
  const order = ['In Progress', 'Approved', 'Completed', 'Rejected']
  const present = new Set(rows.map(historyStatusLabel))
  return [...order.filter((label) => present.has(label)), ...[...present].filter((label) => !order.includes(label)).sort()]
}

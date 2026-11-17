// The Course Equivalency request as shown on the staff review page, built from the rows the
// staff session reads (Request, Course_Equivalency, Course, Student, Program_Change,
// Request_History, and the final Decision row). Pure functions only, so they
// can be tested with `npm test`.

import { toCourseEquivalencyDecisionRecord, type CourseEquivalencyDecisionRecord } from './courseEquivalencyDecision.ts'

export const COURSE_EQUIVALENCY = 'Course Equivalency'

export interface CourseEquivalencyProgram {
  id: string
  name: string
}

export interface CourseEquivalencyReviewRecord {
  request: {
    id: string
    type: string
    status: string
    date: string | null
    time: string | null
    summary: string | null
    studentId: string
  }
  details: {
    oldCourse: { id: string; name: string | null; creditHours: number | null }
    newCourse: { id: string; name: string | null; creditHours: number | null }
    reason: string | null
    programChangeRequestId: string | null
    oldProgram: CourseEquivalencyProgram | null
    newProgram: CourseEquivalencyProgram | null
    planVersion: string | null
    gradeAtSubmission: string | null
    termAtSubmission: number | null
  } | null
  student: {
    id: string
    name: string | null
    email: string | null
    program: string | null
    college: string | null
    cgpa: number | null
    completedHours: number | null
  } | null
  programChange: { requestId: string; status: string | null; date: string | null; from: string | null; to: string | null } | null
  history: { status: string | null; date: string | null; staffId: number | null } | null
  /** The administrator's final decision (Decision row), when one is recorded. Decision only:
   *  an approval never means the transcript or academic record was updated. */
  decision: CourseEquivalencyDecisionRecord | null
}

export type CourseEquivalencyRecordResult =
  | { kind: 'found'; record: CourseEquivalencyReviewRecord }
  | { kind: 'not-found' }
  | { kind: 'other-type'; type: string }

type Row = Record<string, unknown> | null | undefined

const str = (value: unknown) => (value === null || value === undefined || value === '' ? null : String(value))
const num = (value: unknown) => (value === null || value === undefined || value === '' ? null : Number(value))

function program(id: unknown, name: unknown): CourseEquivalencyProgram | null {
  const i = str(id)
  const n = str(name)
  return i && n ? { id: i, name: n } : null
}

export function buildCourseEquivalencyRecord(raw: {
  request: Row
  details: Row
  courses: Row[]
  student: Row
  programChange: Row
  programChangeRequest: Row
  history: Row
  decision?: Row
}): CourseEquivalencyReviewRecord {
  const r = raw.request ?? {}
  const d = raw.details
  const courseRow = (id: string | null) => raw.courses.find((c) => c && str(c.Course_ID) === id) ?? null
  const course = (id: unknown) => {
    const key = str(id) ?? ''
    const row = courseRow(key)
    return { id: key, name: str(row?.Course_Name), creditHours: num(row?.Credit_Hours) }
  }
  const s = raw.student
  const college = (s?.Program as { College_Name?: unknown } | null | undefined)?.College_Name
  const pcId = str(d?.Program_Change_Request_ID)
  return {
    request: {
      id: String(r.Request_ID ?? ''),
      type: String(r.Request_Type ?? ''),
      status: String(r.Current_Status ?? ''),
      date: str(r.Request_Date),
      time: str(r.Submission_Time),
      summary: str(r.Description),
      studentId: String(r.Student_ID ?? ''),
    },
    details: d
      ? {
          oldCourse: course(d.Old_Course_ID),
          newCourse: course(d.New_Course_ID),
          reason: str(d.Reason),
          programChangeRequestId: pcId,
          oldProgram: program(d.Old_Program_ID, d.Old_Program_Name),
          newProgram: program(d.New_Program_ID, d.New_Program_Name),
          planVersion: str(d.Plan_Version),
          gradeAtSubmission: str(d.Old_Course_Grade),
          termAtSubmission: num(d.Old_Course_Term),
        }
      : null,
    student: s
      ? {
          id: String(s.Student_ID ?? ''),
          name: str(s.Student_Name),
          email: str(s.Student_Email),
          program: str(s.Program_Name),
          college: str(college),
          cgpa: num(s.CGPA),
          completedHours: num(s.Completed_Hours),
        }
      : null,
    programChange:
      pcId && (raw.programChange || raw.programChangeRequest)
        ? {
            requestId: pcId,
            status: str(raw.programChangeRequest?.Current_Status),
            date: str(raw.programChangeRequest?.Request_Date),
            from: str(raw.programChange?.Current_Program_Name),
            to: str(raw.programChange?.New_Program_Name),
          }
        : null,
    history: raw.history
      ? { status: str(raw.history.Final_Status), date: str(raw.history.Completion_Date), staffId: num(raw.history.Staff_ID) }
      : null,
    decision: toCourseEquivalencyDecisionRecord(raw.decision),
  }
}

/** One line describing the Program Change context of the request. */
export function programChangeContext(record: CourseEquivalencyReviewRecord): string {
  const d = record.details
  if (!d) return 'No Course Equivalency details were recorded.'
  if (!d.programChangeRequestId) {
    return 'No Program Change was linked when this request was submitted (it predates the program context). The agent checks the student’s current program and any approved Program Change itself.'
  }
  const to = d.newProgram?.name ?? record.programChange?.to
  const from = d.oldProgram?.name ?? record.programChange?.from
  return `Approved Program Change ${d.programChangeRequestId}${from && to ? `: ${from} → ${to}` : ''}${d.planVersion ? ` (study plan ${d.planVersion})` : ''}.`
}

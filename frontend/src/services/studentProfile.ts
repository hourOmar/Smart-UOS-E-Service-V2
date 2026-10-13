import { supabase } from './supabase'

// The signed-in student's own record, read with their session. The
// database policies return only that student's Student row; the program
// and college come from Program through the student's (Program_ID,
// Program_Name) reference. Read-only.

export interface StudentProfileDetails {
  name: string | null
  studentId: string | null
  email: string | null
  program: string | null
  college: string | null
  cgpa: string | null
  completedHours: string | null
  expectedGraduationTerm: string | null
}

interface StudentRowData {
  Student_ID: string | null
  Student_Name: string | null
  Student_Email: string | null
  Program_ID: string | null
  Program_Name: string | null
  CGPA: number | null
  Completed_Hours: number | null
  Expected_Graduation_Term: number | null
  Program: { College_Name: string | null } | { College_Name: string | null }[] | null
}

const text = (value: unknown) => {
  const trimmed = value == null ? '' : String(value).trim()
  return trimmed === '' ? null : trimmed
}

/** Null when the account has no linked Student record. */
export async function fetchStudentProfileDetails(): Promise<StudentProfileDetails | null> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) return null

  const { data, error } = await supabase
    .from('Student')
    .select(
      'Student_ID, Student_Name, Student_Email, Program_ID, Program_Name, CGPA, Completed_Hours, Expected_Graduation_Term, Program(College_Name)',
    )
    .eq('Auth_User_ID', user.id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as unknown as StudentRowData
  const program = Array.isArray(row.Program) ? row.Program[0] : row.Program

  return {
    name: text(row.Student_Name),
    studentId: text(row.Student_ID),
    email: text(row.Student_Email),
    // The program's name as recorded; its code when no name is recorded.
    program: text(row.Program_Name) ?? text(row.Program_ID),
    college: text(program?.College_Name),
    cgpa: row.CGPA == null ? null : row.CGPA.toFixed(2),
    completedHours: row.Completed_Hours == null ? null : String(row.Completed_Hours),
    // Shown as stored (e.g. 202602), the same way terms appear elsewhere.
    expectedGraduationTerm: text(row.Expected_Graduation_Term),
  }
}

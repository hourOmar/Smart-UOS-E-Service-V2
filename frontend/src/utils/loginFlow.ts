// The sign-in sequence of the login page, with the Supabase client passed in so
// it can be tested without a network (tests/loginFlow.test.ts).
//
// 1. Supabase Auth checks the email and password.
// 2. A linked staff member (Authorized_Staff.Auth_User_ID) goes to /admin.
// 3. A linked student goes to /student. The student is found by the signed-in
//    user's Auth UID (Student.Auth_User_ID), exactly as the database policy
//    student_read_own and the rest of the app identify students -- never by
//    email: Supabase Auth stores emails in lowercase while Student_Email keeps
//    the "U..." student ID, so an email comparison can miss a valid student.
// 4. Anyone else is signed out again.

interface MaybeSingleQuery {
  maybeSingle(): PromiseLike<{ data: unknown }>
}

/** The part of the Supabase client the sign-in sequence uses. */
export interface LoginClient {
  auth: {
    signInWithPassword(credentials: { email: string; password: string }): PromiseLike<{
      data: { user: { id: string } | null }
      error: unknown
    }>
    signOut(): PromiseLike<unknown>
  }
  from(table: string): { select(columns: string): { eq(column: string, value: string): MaybeSingleQuery } }
}

export type LoginOutcome = 'staff' | 'student' | 'invalid_credentials' | 'not_registered'

/** The table lookups only (used by the route guard as well). */
export type RoleLookupClient = Pick<LoginClient, 'from'>

/** 'staff' or 'student' for a signed-in Auth user, by Auth UID only; null when
 *  the account is linked to neither. Also used by components/ProtectedRoute.tsx. */
export async function resolveAccountRole(client: RoleLookupClient, userId: string): Promise<'staff' | 'student' | null> {
  const { data: staff } = await client
    .from('Authorized_Staff')
    .select('Staff_ID')
    .eq('Auth_User_ID', userId)
    .maybeSingle()
  if (staff) return 'staff'

  const { data: student } = await client
    .from('Student')
    .select('Student_ID')
    .eq('Auth_User_ID', userId)
    .maybeSingle()
  if (student) return 'student'

  return null
}

export async function signInAndResolveRole(client: LoginClient, email: string, password: string): Promise<LoginOutcome> {
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user) return 'invalid_credentials'

  const role = await resolveAccountRole(client, data.user.id)
  if (role) return role

  await client.auth.signOut()
  return 'not_registered'
}

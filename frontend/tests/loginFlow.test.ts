// Regression tests of the login sequence (utils/loginFlow.ts) with a fake
// Supabase client: no network, no real accounts or passwords. The fake applies
// the database's student_read_own policy -- a Student row is visible only when
// its Auth_User_ID is the signed-in user's id. Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { signInAndResolveRole, type LoginClient } from '../src/utils/loginFlow.ts'

interface FakeUser { id: string; email: string; password: string }
type Row = Record<string, string>

function fakeClient(users: FakeUser[], tables: { Authorized_Staff: Row[]; Student: Row[] }) {
  let signedIn: FakeUser | null = null
  const calls: string[] = []
  const client: LoginClient = {
    auth: {
      async signInWithPassword({ email, password }) {
        calls.push('signIn')
        // Supabase Auth matches the email case-insensitively.
        const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password) ?? null
        signedIn = user
        return user
          ? { data: { user: { id: user.id } }, error: null }
          : { data: { user: null }, error: { message: 'Invalid login credentials' } }
      },
      async signOut() {
        calls.push('signOut')
        signedIn = null
        return {}
      },
    },
    from(table) {
      return {
        select(columns) {
          return {
            eq(column, value) {
              calls.push(`${table}.${column}`)
              return {
                async maybeSingle() {
                  let rows = tables[table as keyof typeof tables] ?? []
                  // Row-level security: students see only their own row.
                  if (table === 'Student') rows = rows.filter((r) => r.Auth_User_ID === signedIn?.id)
                  const row = rows.find((r) => r[column] === value)
                  return { data: row ? Object.fromEntries(columns.split(',').map((c) => [c.trim(), row[c.trim()]])) : null }
                },
              }
            },
          }
        },
      }
    },
  }
  return { client, calls }
}

// Fictional accounts. NEW_STUDENT's Auth email is lowercase while its
// Student_Email keeps the capital "U" (the nine affected accounts);
// WORKING_STUDENT's Auth email matches its Student_Email exactly.
const NEW_STUDENT = { id: 'uid-new', email: 'u25199999@sharjah.ac.ae', password: 'pw-a' }
const WORKING_STUDENT = { id: 'uid-old', email: 'U24299999@sharjah.ac.ae', password: 'pw-b' }
const STAFF = { id: 'uid-staff', email: 'staff@sharjah.ac.ae', password: 'pw-c' }
const NOBODY = { id: 'uid-none', email: 'nobody@sharjah.ac.ae', password: 'pw-d' }
const USERS = [NEW_STUDENT, WORKING_STUDENT, STAFF, NOBODY]

const TABLES = {
  Authorized_Staff: [{ Staff_ID: '100001', Auth_User_ID: 'uid-staff' }],
  Student: [
    { Student_ID: 'U25199999', Student_Email: 'U25199999@sharjah.ac.ae', Auth_User_ID: 'uid-new' },
    { Student_ID: 'U24299999', Student_Email: 'U24299999@sharjah.ac.ae', Auth_User_ID: 'uid-old' },
  ],
}

const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')

test('a student whose Student_Email differs only in letter case reaches the student dashboard', async () => {
  const { client, calls } = fakeClient(USERS, TABLES)
  assert.equal(await signInAndResolveRole(client, 'U25199999@sharjah.ac.ae', 'pw-a'), 'student')
  assert.deepEqual(calls, ['signIn', 'Authorized_Staff.Auth_User_ID', 'Student.Auth_User_ID'])
})

test('an existing working student account still reaches the student dashboard', async () => {
  const { client, calls } = fakeClient(USERS, TABLES)
  assert.equal(await signInAndResolveRole(client, 'U24299999@sharjah.ac.ae', 'pw-b'), 'student')
  assert.ok(!calls.includes('signOut'))
})

test('a staff member reaches the admin dashboard without a Student lookup', async () => {
  const { client, calls } = fakeClient(USERS, TABLES)
  assert.equal(await signInAndResolveRole(client, 'staff@sharjah.ac.ae', 'pw-c'), 'staff')
  assert.deepEqual(calls, ['signIn', 'Authorized_Staff.Auth_User_ID'])
})

test('an authenticated user with no Student or staff record is signed out again', async () => {
  const { client, calls } = fakeClient(USERS, TABLES)
  assert.equal(await signInAndResolveRole(client, 'nobody@sharjah.ac.ae', 'pw-d'), 'not_registered')
  assert.equal(calls.at(-1), 'signOut')
})

test("only the signed-in user's own Student record can match (no email fallback)", async () => {
  // Same email as a student's Student_Email, but this Auth UID is linked to no student.
  const impostor = { id: 'uid-other', email: 'u25199999@sharjah.ac.ae', password: 'pw-x' }
  const { client, calls } = fakeClient([impostor], TABLES)
  assert.equal(await signInAndResolveRole(client, 'u25199999@sharjah.ac.ae', 'pw-x'), 'not_registered')
  assert.ok(!calls.some((c) => c.endsWith('.Student_Email')))
})

test('authentication failure stops before any lookup', async () => {
  const { client, calls } = fakeClient(USERS, TABLES)
  assert.equal(await signInAndResolveRole(client, 'U25199999@sharjah.ac.ae', 'wrong'), 'invalid_credentials')
  assert.equal(await signInAndResolveRole(client, 'unknown@sharjah.ac.ae', 'pw-a'), 'invalid_credentials')
  assert.deepEqual(calls, ['signIn', 'signIn'])
})

test('the login page uses the sequence and keeps its messages and routes; no email lookup remains', () => {
  const page = readFileSync(new URL('../src/pages/LoginPage.tsx', import.meta.url), 'utf8')
  const flow = readFileSync(new URL('../src/utils/loginFlow.ts', import.meta.url), 'utf8')
  assert.match(page, /await signInAndResolveRole\(/)
  assert.match(page, /'Invalid email or password\.'/)
  assert.match(page, /'This account is not registered as a student or authorized staff member\.'/)
  assert.match(page, /navigate\('\/admin'\)/)
  assert.match(page, /navigate\('\/student'\)/)
  for (const text of [codeOnly(page), codeOnly(flow)]) {
    assert.doesNotMatch(text, /Student_Email|ilike/)
    assert.doesNotMatch(text, /\.eq\(\s*'[^']*',\s*[^)]*\.email\b/)
  }
  assert.equal(flow.match(/\.eq\('Auth_User_ID', userId\)/g)?.length, 2)
})

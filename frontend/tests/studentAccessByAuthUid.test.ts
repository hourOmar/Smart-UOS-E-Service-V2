// Regression tests: the student route guard (components/ProtectedRoute.tsx) and
// the student profile hook (hooks/useStudentProfile.ts) identify the student by
// Auth UID, so a student whose Auth email differs from Student_Email only in
// letter case can open /student and load their profile. The role check runs
// against a fake client applying the database's student_read_own policy (no
// network, fictional accounts only). Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { resolveAccountRole, type RoleLookupClient } from '../src/utils/loginFlow.ts'

type Row = Record<string, string>
const TABLES: Record<string, Row[]> = {
  Authorized_Staff: [{ Staff_ID: '100001', Auth_User_ID: 'uid-staff' }],
  Student: [
    // Auth email "u25199999@…" (lowercase); Student_Email keeps the capital U.
    { Student_ID: 'U25199999', Student_Email: 'U25199999@sharjah.ac.ae', Auth_User_ID: 'uid-new' },
    // A working account whose Auth email matches exactly.
    { Student_ID: 'U24299999', Student_Email: 'U24299999@sharjah.ac.ae', Auth_User_ID: 'uid-old' },
  ],
}

/** A client signed in as `signedInId`: Student rows are visible only when they
 *  are the signed-in user's own (student_read_own). Records each lookup column. */
function clientFor(signedInId: string) {
  const lookups: string[] = []
  const client: RoleLookupClient = {
    from(table) {
      return {
        select() {
          return {
            eq(column, value) {
              lookups.push(`${table}.${column}`)
              return {
                async maybeSingle() {
                  let rows = TABLES[table] ?? []
                  if (table === 'Student') rows = rows.filter((r) => r.Auth_User_ID === signedInId)
                  return { data: rows.find((r) => r[column] === value) ?? null }
                },
              }
            },
          }
        },
      }
    },
  }
  return { client, lookups }
}

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')
const GUARD = source('../src/components/ProtectedRoute.tsx')
const PROFILE = source('../src/hooks/useStudentProfile.ts')

// -- route guard ---------------------------------------------------------------------

test('route guard: a student whose email differs only in letter case is a student', async () => {
  const { client, lookups } = clientFor('uid-new')
  assert.equal(await resolveAccountRole(client, 'uid-new'), 'student')
  assert.deepEqual(lookups, ['Authorized_Staff.Auth_User_ID', 'Student.Auth_User_ID'])
})

test('route guard: an existing working student is still a student', async () => {
  const { client } = clientFor('uid-old')
  assert.equal(await resolveAccountRole(client, 'uid-old'), 'student')
})

test('route guard: staff are staff, found before any Student lookup', async () => {
  const { client, lookups } = clientFor('uid-staff')
  assert.equal(await resolveAccountRole(client, 'uid-staff'), 'staff')
  assert.deepEqual(lookups, ['Authorized_Staff.Auth_User_ID'])
})

test('route guard: a signed-in account linked to neither has no role', async () => {
  const { client } = clientFor('uid-none')
  assert.equal(await resolveAccountRole(client, 'uid-none'), null)
})

test('route guard: authorization rules and redirects are unchanged', () => {
  const code = codeOnly(GUARD)
  assert.match(code, /const account = await resolveAccountRole\(supabase as unknown as RoleLookupClient, user\.id\)/)
  assert.match(code, /if \(account === 'staff'\) \{\s+setRole\('admin'\)\s+\} else if \(account === 'student'\) \{\s+setRole\('student'\)\s+\}/)
  assert.match(code, /if \(!user\) \{\s+setLoading\(false\)\s+return\s+\}/)
  assert.match(code, /if \(loading\) \{\s+return <p>Loading\.\.\.<\/p>\s+\}/)
  assert.match(code, /if \(!role\) \{\s+return <Navigate to="\/" replace \/>/)
  assert.match(code, /if \(role !== requiredRole\) \{[\s\S]*?to=\{role === 'admin' \? '\/admin' : '\/student'\}/)
  assert.doesNotMatch(code, /Student_Email|user\.email|signOut/)
})

// -- profile hook --------------------------------------------------------------------

test('profile hook: the student is found by Auth UID; the email is for display only', () => {
  const code = codeOnly(PROFILE)
  assert.match(code, /if \(userError \|\| !user\) \{/)
  assert.match(code, /\.from\('Student'\)\s+\.select\('Student_ID, Student_Name'\)\s+\.eq\('Auth_User_ID', user\.id\)\s+\.maybeSingle\(\)/)
  assert.doesNotMatch(code, /Student_Email|\.eq\([^)]*email/i)
  assert.match(code, /const email = user\.email \?\? null/)
  assert.match(code, /email,\n/)
})

// -- whole frontend ------------------------------------------------------------------

test('no Student lookup by email remains anywhere in frontend/src', () => {
  const root = fileURLToPath(new URL('../src', import.meta.url))
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(name)) {
        const code = codeOnly(readFileSync(path, 'utf8'))
        if (/\.(eq|ilike|match|filter|or)\(\s*['"`][^'"`]*Student_Email/.test(code)) offenders.push(path)
      }
    }
  }
  walk(root)
  assert.deepEqual(offenders, [])
})

/**
 * Route-test harness: calls the real route handlers with `Request` objects against a private test
 * database (a clone of zaboon_template) with the fixture course published into a temp folder.
 *
 *   const h = await createHarness()          // in beforeAll
 *   const alice = await h.guest()
 *   const res = await h.call(sessionsRoute.POST, { path: '/api/sessions', body, user: alice })
 *   await h.close()                           // in afterAll
 *
 * AUTH_MODE=local + ZABOON_DEV_AUTH=1: tokens are minted with `signLocalToken`, users live in the
 * dev user store (auth.users over a loopback superuser connection), and `now` time-travels with the
 * `x-test-now` header.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { TEST_NOW_HEADER } from '@zaboon/contracts'
import { createDb, repos, withSystem, type DbHandle } from '@zaboon/db'
import { createTestDatabase, type TestDatabase } from '@zaboon/db/testing'
import { loadCourse, type LoadedCourse } from '../../../../tools/content-cli/src/load'
import { publishLocal, type PublishResult } from '../../../../tools/content-cli/src/publish'
import { repoRoot } from '../../../../tools/content-cli/src/paths'
import {
  createAdminUser,
  createAnonymousUser,
  linkEmail,
  signInWithEmail,
  type DevUser,
} from '../../lib/server/auth/dev-users'
import { signLocalToken } from '../../lib/server/auth/local'
import { resetContentCache } from '../../lib/server/content'
import { resetServerEnv } from '../../lib/server/env'

export type Handler = (
  req: Request,
  ctx: { params?: Promise<Record<string, string>> },
) => Promise<Response>

export interface TestUser extends DevUser {
  token: string
}

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
  user?: TestUser | null
  /** Server clock for this request (x-test-now). */
  now?: Date | string
  params?: Record<string, string>
  headers?: Record<string, string>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read arbitrary JSON response bodies
export type Json = any

export interface CallResult<T = Json> {
  status: number
  body: T
}

export interface Harness {
  tdb: TestDatabase
  contentDir: string
  /** Superuser connection for assertions that must see every row. */
  sql: postgres.Sql
  /** app_server handle (system-scope fixtures). */
  db: DbHandle
  guest(): Promise<TestUser>
  member(email?: string): Promise<TestUser>
  admin(): Promise<TestUser>
  /** Links an email to a guest (same user id, no longer anonymous). */
  link(user: TestUser, email: string): Promise<TestUser>
  call<T = Json>(handler: Handler, opts: CallOptions): Promise<CallResult<T>>
  /** Publishes a course (by folder name, or an edited LoadedCourse) as its next current version. */
  publish(course: 'fixtures' | 'fa-en' | LoadedCourse): Promise<PublishResult>
  close(): Promise<void>
}

type Globals = typeof globalThis & {
  __zaboonDb?: DbHandle
  __zaboonDevAuthSql?: postgres.Sql
}

let emailSeq = 0

/** A course from content/<name> (fixtures is the frozen e2e course). */
export function loadCourseDir(name: 'fixtures' | 'fa-en'): LoadedCourse {
  return loadCourse(join(repoRoot(), 'content', name))
}

async function withToken(user: DevUser): Promise<TestUser> {
  const { accessToken } = await signLocalToken({
    userId: user.id,
    isAnonymous: user.isAnonymous,
    email: user.email,
    isAdmin: user.isAdmin,
  })
  return { ...user, token: accessToken }
}

export async function createHarness(
  opts: { courses?: ('fixtures' | 'fa-en')[] } = {},
): Promise<Harness> {
  const tdb = await createTestDatabase()
  const contentDir = mkdtempSync(join(tmpdir(), 'zaboon-api-content-'))
  Object.assign(process.env, {
    AUTH_MODE: 'local',
    ZABOON_DEV_AUTH: '1',
    DATABASE_URL_APP_SERVER: tdb.appUrl,
    ZABOON_CONTENT_DIR: contentDir,
    ZABOON_DEV_AUTH_SECRET: 'api-test-secret-api-test-secret-api', // pragma: allowlist secret
  })
  delete process.env.VERCEL_ENV
  delete process.env.CONTENT_BASE_URL
  resetServerEnv()
  resetContentCache()

  const db = createDb(tdb.appUrl, { max: 2 })
  // Route tests make many calls per user and per minute; the limiter itself has its own tests.
  await withSystem(db.db, (tx) =>
    repos.content.setAppConfig(
      tx,
      'rateLimits',
      Object.fromEntries(
        ['default', 'sessions', 'events', 'complete', 'reports', 'auth'].map((k) => [
          k,
          { perMinute: 100_000 },
        ]),
      ),
    ),
  )
  const sql = postgres(tdb.adminUrl, { max: 2, onnotice: () => {} })

  const publish = async (course: 'fixtures' | 'fa-en' | LoadedCourse) => {
    const r = await publishLocal({
      course: typeof course === 'string' ? loadCourseDir(course) : course,
      outRoot: contentDir,
      databaseUrl: tdb.appUrl,
      allowDrafts: course === 'fa-en',
      makeCurrent: true,
    })
    resetContentCache()
    return r
  }
  for (const c of opts.courses ?? ['fixtures']) await publish(c)

  const harness: Harness = {
    tdb,
    contentDir,
    sql,
    db,
    guest: async () => withToken(await createAnonymousUser()),
    member: async (email) =>
      withToken(await signInWithEmail(email ?? `member-${process.pid}-${++emailSeq}@zaboon.test`)),
    admin: async () => withToken(await createAdminUser()),
    link: async (user, email) => withToken(await linkEmail(user.id, email)),
    async call(handler, o) {
      const headers: Record<string, string> = { ...o.headers }
      if (o.user) headers.authorization = `Bearer ${o.user.token}`
      if (o.now !== undefined)
        headers[TEST_NOW_HEADER] = typeof o.now === 'string' ? o.now : o.now.toISOString()
      const method = o.method ?? (o.body === undefined ? 'GET' : 'POST')
      if (o.body !== undefined) headers['content-type'] = 'application/json'
      const res = await handler(
        new Request(`http://localhost${o.path}`, {
          method,
          headers,
          ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
        }),
        { params: Promise.resolve(o.params ?? {}) },
      )
      return { status: res.status, body: await res.json() }
    },
    publish,
    async close() {
      const g = globalThis as Globals
      await g.__zaboonDb?.close()
      delete g.__zaboonDb
      await g.__zaboonDevAuthSql?.end()
      delete g.__zaboonDevAuthSql
      await db.close()
      await sql.end()
      await tdb.drop()
      rmSync(contentDir, { recursive: true, force: true })
    },
  }
  return harness
}

/**
 * Local emulation of Supabase Auth's user store (AUTH_MODE=local + ZABOON_DEV_AUTH=1 only). Writes
 * auth.users over a loopback superuser connection, like GoTrue does in production; the profile
 * trigger on auth.users then creates the learner's rows.
 */
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { isLoopbackUrl, serverEnv } from '../env'
import { ApiError } from '../errors'

export interface DevUser {
  id: string
  isAnonymous: boolean
  email: string | null
  isAdmin: boolean
}

type Sql = ReturnType<typeof postgres>
const holder = globalThis as typeof globalThis & { __zaboonDevAuthSql?: Sql }

function adminSql(): Sql {
  const env = serverEnv()
  if (!env.devAuth) throw new ApiError('not_found', 'not found')
  if (!holder.__zaboonDevAuthSql) {
    const url = new URL(env.databaseUrl)
    if (!isLoopbackUrl(env.databaseUrl)) throw new ApiError('not_found', 'not found')
    holder.__zaboonDevAuthSql = postgres({
      host: url.hostname,
      port: Number(url.port || 5432),
      database: url.pathname.replace(/^\//, ''),
      user: 'supabase_admin',
      max: 2,
      onnotice: () => {},
    })
  }
  return holder.__zaboonDevAuthSql
}

interface Row {
  id: string
  is_anonymous: boolean
  email: string | null
  raw_app_meta_data: { role?: string } | null
}

const toUser = (r: Row): DevUser => ({
  id: r.id,
  isAnonymous: r.is_anonymous,
  email: r.email,
  isAdmin: r.raw_app_meta_data?.role === 'admin',
})

export async function createAnonymousUser(): Promise<DevUser> {
  const sql = adminSql()
  const [row] = await sql<Row[]>`
    INSERT INTO auth.users (is_anonymous, raw_app_meta_data)
    VALUES (true, ${sql.json({ provider: 'anonymous', providers: ['anonymous'] })})
    RETURNING id, is_anonymous, email, raw_app_meta_data`
  return toUser(row!)
}

/** Email sign-in (OTP in production): returns the account with that email, creating it if new. */
export async function signInWithEmail(email: string): Promise<DevUser> {
  const sql = adminSql()
  const normalized = email.trim().toLowerCase()
  const [row] = await sql<Row[]>`
    WITH inserted AS (
      INSERT INTO auth.users (email, is_anonymous, raw_app_meta_data)
      VALUES (${normalized}, false, ${sql.json({ provider: 'email', providers: ['email'] })})
      ON CONFLICT (email) DO NOTHING
      RETURNING id, is_anonymous, email, raw_app_meta_data
    )
    SELECT * FROM inserted
    UNION ALL
    SELECT id, is_anonymous, email, raw_app_meta_data FROM auth.users WHERE email = ${normalized}
    LIMIT 1`
  await sql`
    INSERT INTO auth.identities (user_id, provider, provider_id, identity_data)
    VALUES (${row!.id}, 'email', ${normalized}, ${sql.json({ email: normalized })})
    ON CONFLICT (provider, provider_id) DO NOTHING`
  await sql`UPDATE auth.users SET last_sign_in_at = now() WHERE id = ${row!.id}`
  return toUser(row!)
}

/**
 * Links an email identity to an anonymous user (Supabase `updateUser({ email })`). Like Supabase, an
 * email that already belongs to another account fails with `identity_already_exists`, which starts
 * the merge flow.
 */
export async function linkEmail(userId: string, email: string): Promise<DevUser> {
  const sql = adminSql()
  const normalized = email.trim().toLowerCase()
  return sql.begin(async (tx) => {
    const [owner] = await tx<
      { id: string }[]
    >`SELECT id FROM auth.users WHERE email = ${normalized} FOR UPDATE`
    if (owner && owner.id !== userId) {
      throw new ApiError('identity_already_exists', 'this email already belongs to another account')
    }
    const [row] = await tx<Row[]>`
      UPDATE auth.users
      SET email = ${normalized},
          is_anonymous = false,
          raw_app_meta_data = raw_app_meta_data || ${tx.json({ provider: 'email', providers: ['anonymous', 'email'] })},
          updated_at = now()
      WHERE id = ${userId}
      RETURNING id, is_anonymous, email, raw_app_meta_data`
    if (!row) throw new ApiError('not_found', 'user not found')
    await tx`
      INSERT INTO auth.identities (user_id, provider, provider_id, identity_data)
      VALUES (${userId}, 'email', ${normalized}, ${tx.json({ email: normalized })})
      ON CONFLICT (provider, provider_id) DO NOTHING`
    return toUser(row)
  })
}

/** A new admin account (dev only), for exercising the admin screens. */
export async function createAdminUser(): Promise<DevUser> {
  const sql = adminSql()
  const email = `admin-${randomUUID().slice(0, 8)}@zaboon.test`
  const [row] = await sql<Row[]>`
    INSERT INTO auth.users (email, is_anonymous, raw_app_meta_data)
    VALUES (${email}, false, ${sql.json({ provider: 'email', providers: ['email'], role: 'admin' })})
    RETURNING id, is_anonymous, email, raw_app_meta_data`
  return toUser(row!)
}

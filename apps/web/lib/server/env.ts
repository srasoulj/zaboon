/**
 * Server environment, read once per process (docs/adr/0009).
 *
 * AUTH_MODE=local is the dev/test mode: it refuses to run on Vercel or against a database that is
 * not on loopback, so local tokens can never reach real data.
 */
export type AuthMode = 'local' | 'supabase'

export interface ServerEnv {
  authMode: AuthMode
  /** Dev-auth routes (`*.dev.ts`) are compiled in only when ZABOON_DEV_AUTH=1 in local mode. */
  devAuth: boolean
  /** app_server connection string (never a superuser, never BYPASSRLS). */
  databaseUrl: string
  supabaseUrl: string | null
  /** Where immutable content bundles live; null means this app's own /content (apps/web/public). */
  contentBaseUrl: string | null
  cronSecret: string | null
}

// Local-only dev credential for the loopback database created by scripts/db-local.sh.
const LOCAL_DATABASE_URL = 'postgres://app_server:app_server_local@127.0.0.1:54322/zaboon' // pragma: allowlist secret

export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

let cached: ServerEnv | undefined

export function serverEnv(): ServerEnv {
  if (cached) return cached
  const mode = process.env.AUTH_MODE ?? 'supabase'
  if (mode !== 'local' && mode !== 'supabase')
    throw new Error(`AUTH_MODE must be "local" or "supabase", got "${mode}"`)
  const databaseUrl =
    process.env.DATABASE_URL_APP_SERVER ?? (mode === 'local' ? LOCAL_DATABASE_URL : '')
  if (!databaseUrl) throw new Error('DATABASE_URL_APP_SERVER is not set')
  if (mode === 'local') {
    if (process.env.VERCEL_ENV) throw new Error('AUTH_MODE=local must never run on Vercel')
    if (!isLoopbackUrl(databaseUrl)) throw new Error('AUTH_MODE=local requires a loopback database')
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || null
  if (mode === 'supabase' && !supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  cached = {
    authMode: mode,
    devAuth: mode === 'local' && process.env.ZABOON_DEV_AUTH === '1',
    databaseUrl,
    supabaseUrl,
    contentBaseUrl: process.env.CONTENT_BASE_URL || null,
    cronSecret: process.env.CRON_SECRET || null,
  }
  return cached
}

/** Tests only: forget the cached environment. */
export function resetServerEnv(): void {
  cached = undefined
}

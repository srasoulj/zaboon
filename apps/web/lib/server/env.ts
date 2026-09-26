/**
 * Server environment, read once per process (docs/adr/0009).
 *
 * AUTH_MODE=local is the dev/test mode: it refuses to run on Vercel or against a database that is
 * not on loopback, so local tokens can never reach real data.
 */
import { contentBaseUrlFromEnv } from '../content-base-url'

export type AuthMode = 'local' | 'supabase'

export interface ServerEnv {
  authMode: AuthMode
  /** Dev-auth routes (`*.dev.ts`) are compiled in only when ZABOON_DEV_AUTH=1 in local mode. */
  devAuth: boolean
  /** app_server connection string (never a superuser, never BYPASSRLS). */
  databaseUrl: string
  supabaseUrl: string | null
  /**
   * Where immutable content bundles live: CONTENT_BASE_URL, else the Supabase project's public
   * `content` bucket (lib/content-base-url.ts); null means this app's own /content (apps/web/public).
   */
  contentBaseUrl: string | null
  cronSecret: string | null
  /**
   * P2: the key of the purpose-scoped signed tokens (signing.ts), from APP_SIGNING_SECRET. Null
   * when unset: local mode then signs with a fixed dev key; production answers 503 `unavailable`.
   */
  signingSecret: string | null
  /**
   * P2: the app's own OpenRouter key (speak transcription; ADR 0008), passed to @zaboon/ai by the
   * server. Null when unset: the routes that need it answer 503 `unavailable`.
   */
  openrouterAppKey: string | null
  /**
   * Whether `X-Forwarded-For` / `X-Real-IP` name the caller, for per-IP rate-limit keys
   * (with-route.ts `clientIp`). True on Vercel (VERCEL or VERCEL_ENV), whose edge overwrites
   * `X-Forwarded-For`, or with ZABOON_TRUST_PROXY=1 behind a self-hosted proxy that likewise
   * replaces it (nginx: `$remote_addr`, not `$proxy_add_x_forwarded_for`, which appends to what the
   * client sent). Otherwise the headers are client-controlled (`next start` only fills them in when
   * absent), so every unauthenticated caller shares one bucket rather than choosing its own.
   */
  trustProxy: boolean
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
    contentBaseUrl: contentBaseUrlFromEnv(process.env) || null,
    cronSecret: process.env.CRON_SECRET || null,
    signingSecret: process.env.APP_SIGNING_SECRET || null,
    openrouterAppKey: process.env.OPENROUTER_API_KEY_APP || null,
    trustProxy:
      !!process.env.VERCEL || !!process.env.VERCEL_ENV || process.env.ZABOON_TRUST_PROXY === '1',
  }
  return cached
}

/** Tests only: forget the cached environment. */
export function resetServerEnv(): void {
  cached = undefined
}

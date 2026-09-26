/**
 * withRoute: the one way to build an API route handler (ADR 0009; orchestrator-owned).
 *
 *   export const POST = withRoute(routes.createSession, async ({ body, user, db, now, config }) => { … })
 *
 * It authenticates the caller per the route's `auth`, rejects outdated clients (426), applies the
 * route's rate-limit bucket, caps and validates the request and validates the response against the
 * zod contracts, reads the time from the Clock seam and the feature flags from the flags seam
 * (flags.ts: the `x-test-flags` header in local mode only), and turns every failure into the error
 * envelope.
 */
import type { z } from 'zod'
import {
  APP_VERSION_HEADER,
  DEFAULT_APP_CONFIG,
  DEFAULT_MAX_BODY_BYTES,
  type AppConfig,
  type RouteAuth,
  type RouteDef,
} from '@zaboon/contracts'
import { ConflictError, NotFoundError, repos, type Db } from '@zaboon/db'
import { authenticate, type AuthUser } from './auth'
import { cronAuthorized } from './auth/cron'
import { requestNow } from './clock'
import { getRuntimeConfig } from './config'
import { getDb } from './db'
import { serverEnv } from './env'
import { ApiError, errorResponse } from './errors'
import { requestFlags } from './flags'

type SignedIn = 'user' | 'member' | 'admin'

export interface RouteContext<R extends RouteDef> {
  req: Request
  params: Record<string, string>
  body: R['request'] extends z.ZodType ? z.output<R['request']> : undefined
  /** The caller; non-null on routes that require sign-in. */
  user: R['auth'] extends SignedIn ? AuthUser : AuthUser | null
  now: Date
  db: Db
  config: AppConfig
  /** Feature flags for this request: configured flags, plus `x-test-flags` in local mode only. */
  flags: Record<string, boolean>
}

export type RouteHandler<R extends RouteDef> = (
  ctx: RouteContext<R>,
) => Promise<z.input<R['response']>>

interface NextRouteContext {
  params?: Promise<Record<string, string | string[] | undefined> | undefined>
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local'
}

async function authorize(auth: RouteAuth, req: Request): Promise<AuthUser | null> {
  const env = serverEnv()
  switch (auth) {
    case 'dev':
      if (!env.devAuth) throw new ApiError('not_found', 'not found')
      return authenticate(req)
    case 'cron': {
      if (!cronAuthorized(req.headers.get('authorization'), env.cronSecret)) {
        throw new ApiError('unauthorized', 'cron secret required')
      }
      return null
    }
    case 'none':
      return req.headers.has('authorization') ? authenticate(req) : null
    default: {
      const user = await authenticate(req)
      if (!user) throw new ApiError('unauthorized', 'sign-in required')
      if (auth === 'member' && user.isAnonymous)
        throw new ApiError('forbidden', 'a linked account is required')
      if (auth === 'admin' && !user.isAdmin) throw new ApiError('forbidden', 'admins only')
      return user
    }
  }
}

/**
 * The rate limit of a route's bucket: its configured entry, else the built-in one for that bucket,
 * else the `default` bucket's. A config without an entry for the bucket (an app_config row written
 * before the bucket existed, say) neither crashes the route nor leaves it unmetered.
 */
export function bucketLimit(config: AppConfig, bucket: string): { perMinute: number } {
  return (
    config.rateLimits[bucket] ??
    DEFAULT_APP_CONFIG.rateLimits[bucket] ??
    config.rateLimits.default ??
    DEFAULT_APP_CONFIG.rateLimits.default!
  )
}

function bodyTooLarge(maxBytes: number): ApiError {
  return new ApiError('validation', `request body is larger than ${maxBytes} bytes`)
}

/**
 * The request body as UTF-8 text, at most `maxBytes` bytes: a bigger declared `content-length` is
 * refused before reading, and a body that turns out bigger (no or a false `content-length`) as
 * soon as the read passes the limit, so an oversized body is never buffered whole.
 */
async function readBodyText(req: Request, maxBytes: number): Promise<string> {
  if (Number(req.headers.get('content-length')) > maxBytes) throw bodyTooLarge(maxBytes)
  if (!req.body) return ''
  const reader = req.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxBytes) {
      reader.cancel().catch(() => {})
      throw bodyTooLarge(maxBytes)
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

/** Reads (at most `maxBytes` bytes), parses and validates a JSON request body. */
export async function readBody(
  req: Request,
  schema: z.ZodType,
  maxBytes: number,
): Promise<unknown> {
  let raw: unknown
  const text = await readBodyText(req, maxBytes)
  try {
    raw = text.length === 0 ? {} : JSON.parse(text)
  } catch {
    throw new ApiError('validation', 'request body is not valid JSON')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new ApiError(
      'validation',
      'request does not match the contract',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  return parsed.data
}

/**
 * A foreign-key violation on a `user_id` column: the row being written belongs to a user that no
 * longer exists, i.e. the (still unexpired) token of a deleted or merged-away account (#27).
 */
export function isGoneUserViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 3; depth++) {
    const pg = e as {
      code?: unknown
      constraint_name?: unknown
      constraint?: unknown
      cause?: unknown
    }
    const constraint = String(pg.constraint_name ?? pg.constraint ?? '')
    if (pg.code === '23503' && /user_id/.test(constraint)) return true
    e = pg.cause
  }
  return false
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  if (err instanceof NotFoundError) return new ApiError('not_found', err.message)
  if (err instanceof ConflictError) return new ApiError('conflict', err.message)
  if (isGoneUserViolation(err)) return new ApiError('unauthorized', 'This account no longer exists')
  console.error('[api] unhandled error', err)
  return new ApiError('internal', 'internal error')
}

export function withRoute<R extends RouteDef>(def: R, handler: RouteHandler<R>) {
  return async (req: Request, next: NextRouteContext): Promise<Response> => {
    try {
      const db = getDb()
      const user = await authorize(def.auth, req)
      const { config, flags: configuredFlags } = await getRuntimeConfig(db)
      const now = requestNow(req)
      const flags = requestFlags(req, configuredFlags)

      const clientVersion = req.headers.get(APP_VERSION_HEADER)
      if (clientVersion && compareVersions(clientVersion, config.minAppVersion) < 0) {
        throw new ApiError(
          'upgrade_required',
          `app version ${config.minAppVersion} or newer is required`,
        )
      }

      // Dev auth emulates Supabase Auth, which has its own limits; everything else is metered.
      if (def.auth !== 'dev') {
        const limit = bucketLimit(config, def.bucket)
        const key = `${def.bucket}:${user ? `u:${user.id}` : `ip:${clientIp(req)}`}`
        const r = await repos.rateLimits.consumeToken(db, key, limit.perMinute, {
          now: now.toISOString(),
        })
        if (!r.allowed) {
          const retryAfter = Number.isFinite(r.retryAfterMs) ? Math.ceil(r.retryAfterMs / 1000) : 60
          throw new ApiError('rate_limited', 'too many requests', undefined, {
            'retry-after': String(retryAfter),
          })
        }
      }

      const body =
        def.request && req.method !== 'GET' && req.method !== 'HEAD'
          ? await readBody(req, def.request, def.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES)
          : undefined
      // Static routes resolve `params` to undefined.
      const rawParams = (await next?.params) ?? {}
      const params: Record<string, string> = {}
      for (const [k, v] of Object.entries(rawParams)) if (typeof v === 'string') params[k] = v

      const result = await handler({
        req,
        params,
        body,
        user,
        now,
        db,
        config,
        flags,
      } as RouteContext<R>)
      const out = def.response.safeParse(result)
      if (!out.success) {
        console.error(
          `[api] ${def.method} ${def.path} response violates its contract`,
          out.error.issues,
        )
        throw new ApiError(
          'internal',
          'response does not match the contract',
          serverEnv().authMode === 'local' ? out.error.issues : undefined,
        )
      }
      return Response.json(out.data, { headers: { 'cache-control': 'no-store' } })
    } catch (err) {
      return errorResponse(toApiError(err))
    }
  }
}

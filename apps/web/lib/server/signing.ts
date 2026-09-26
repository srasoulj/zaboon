/**
 * Purpose-scoped signed tokens (orchestrator-owned; Wave 4). A token is
 *
 *   v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(key(purpose), "v1.<base64url(JSON payload)>"))>
 *
 *   const token = sign('speak', { s: sessionId, i: index, h: digest }, { expiresAt })
 *   const payload = verify('speak', token, ctx.now) // the payload, or null
 *
 * - The signed JSON carries `purpose` and `exp` (epoch milliseconds) next to the caller's fields;
 *   `verify` returns the caller's fields only for the purpose the token was signed for, and only
 *   while `now < exp`. Each purpose also signs with its own key, HMAC-SHA256(secret,
 *   "zaboon:signing:v1:<purpose>"), so a token never verifies for another purpose.
 * - Signatures compare in constant time (`timingSafeEqual`), and only in their canonical encoding.
 * - Time comes from the caller (`ctx.now`); this module never reads the clock.
 * - The secret is APP_SIGNING_SECRET (at least 32 characters). In AUTH_MODE=local an unset secret
 *   falls back to LOCAL_DEV_SIGNING_SECRET (public, like the local database password). In
 *   production a missing or short secret throws `SigningUnavailableError`: an ApiError
 *   `unavailable`, so withRoute answers 503.
 * - Tokens are signed, not encrypted: never put a secret or personal data in the payload.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { serverEnv } from './env'
import { ApiError } from './errors'

export const SIGNING_VERSION = 'v1'
/** AUTH_MODE=local only, when APP_SIGNING_SECRET is unset: a fixed, public dev key. */
export const LOCAL_DEV_SIGNING_SECRET = 'zaboon-local-dev-signing-key-never-use-in-production' // pragma: allowlist secret
export const MIN_SIGNING_SECRET_LENGTH = 32
/** `verify` treats anything longer as malformed. */
export const MAX_TOKEN_LENGTH = 4096

/** The caller's fields: any JSON object without the reserved keys `purpose` and `exp`. */
export type SignedPayload = Record<string, unknown>

/** APP_SIGNING_SECRET is missing or too short outside local mode (503 `unavailable`). */
export class SigningUnavailableError extends ApiError {
  constructor(readonly reason: string) {
    super('unavailable', 'this feature is temporarily unavailable')
    this.name = 'SigningUnavailableError'
  }
}

const PURPOSE = /^[a-z][a-z0-9_-]{0,39}$/
const TOKEN = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/

function assertPurpose(purpose: string): void {
  if (!PURPOSE.test(purpose)) throw new Error(`signing: invalid purpose "${purpose}"`)
}

function secret(): string {
  const env = serverEnv()
  const value = env.signingSecret ?? (env.authMode === 'local' ? LOCAL_DEV_SIGNING_SECRET : null)
  if (value === null) throw new SigningUnavailableError('APP_SIGNING_SECRET is not set')
  if (value.length < MIN_SIGNING_SECRET_LENGTH)
    throw new SigningUnavailableError(
      `APP_SIGNING_SECRET is shorter than ${MIN_SIGNING_SECRET_LENGTH} characters`,
    )
  return value
}

function signature(purpose: string, signed: string): string {
  const key = createHmac('sha256', secret())
    .update(`zaboon:signing:${SIGNING_VERSION}:${purpose}`)
    .digest()
  return createHmac('sha256', key).update(signed).digest('base64url')
}

/**
 * Throws `SigningUnavailableError` (503) when tokens can't be signed right now. A route whose
 * answer includes a token checks this before it spends anything (quota, a paid provider call), so
 * a missing secret costs nothing.
 */
export function assertSigningAvailable(): void {
  secret()
}

/** Signs `payload` for `purpose` until `expiresAt` (normally the session's `expiresAt`). */
export function sign(purpose: string, payload: SignedPayload, opts: { expiresAt: Date }): string {
  assertPurpose(purpose)
  const exp = opts.expiresAt.getTime()
  if (!Number.isFinite(exp)) throw new Error('signing: expiresAt is not a valid date')
  if (Object.hasOwn(payload, 'purpose') || Object.hasOwn(payload, 'exp'))
    throw new Error('signing: `purpose` and `exp` are reserved payload keys')
  const body = Buffer.from(JSON.stringify({ ...payload, purpose, exp }), 'utf8').toString(
    'base64url',
  )
  const signed = `${SIGNING_VERSION}.${body}`
  return `${signed}.${signature(purpose, signed)}`
}

/**
 * The payload of a token signed for `purpose` that has not expired at `now`, or null for anything
 * else: malformed, tampered, signed with another key or for another purpose, or expired.
 */
export function verify(purpose: string, token: string, now: Date): SignedPayload | null {
  assertPurpose(purpose)
  if (!Number.isFinite(now.getTime())) throw new Error('signing: now is not a valid date')
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null
  const match = TOKEN.exec(token)
  if (!match) return null
  const body = match[1]!
  const given = Buffer.from(match[2]!, 'utf8')
  const expected = Buffer.from(signature(purpose, `${SIGNING_VERSION}.${body}`), 'utf8')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null

  let data: unknown
  try {
    data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const { purpose: signedFor, exp, ...payload } = data as Record<string, unknown>
  if (signedFor !== purpose) return null
  if (typeof exp !== 'number' || !Number.isFinite(exp) || now.getTime() >= exp) return null
  return payload
}

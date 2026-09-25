import { createHash, timingSafeEqual } from 'node:crypto'

const digest = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest()

/**
 * Vercel Cron authentication (orchestrator-owned): Vercel sends `Authorization: Bearer
 * $CRON_SECRET` with every scheduled GET. Fails closed when no secret is configured. Both values
 * are hashed first, so `timingSafeEqual` always compares equal-length buffers and the comparison
 * time reveals neither the secret nor its length.
 */
export function cronAuthorized(authorization: string | null, secret: string | null): boolean {
  if (!secret) return false
  if (authorization === null) return false
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))
}

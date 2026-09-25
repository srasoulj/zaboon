/**
 * The outbox's sender: sends an entry only with ITS OWN user's token. The user id and the token are
 * read together from one `auth.getSession()` and the request uses exactly that token, so a sign-out
 * or a new guest landing mid-flush can never send user A's write with user B's token. A mismatch,
 * or a 404/403 while the session no longer belongs to the entry's user, is an
 * IdentityMismatchError: the entry waits for its user instead of being dropped. Without an auth
 * client nothing is sent at all (a send with an unknown token is exactly the race this prevents).
 */
import type { AuthClient, AuthSession } from '../auth-client'
import type { ApiClient } from '../api-client'
import { IdentityMismatchError, type OutboxSender } from './outbox'

export interface IdentitySenderDeps {
  /** The auth client of the mounted replayer, read at send time (null: nothing is sent). */
  auth: () => Pick<AuthClient, 'getSession'> | null
  /** An API client that always sends `accessToken`. */
  clientFor: (accessToken: string) => ApiClient
}

const IDENTITY_SENSITIVE = new Set(['not_found', 'forbidden', 'unauthorized'])

function codeOf(e: unknown): string | null {
  return e && typeof e === 'object' && 'code' in e && typeof e.code === 'string' ? e.code : null
}

export function identitySender(deps: IdentitySenderDeps): OutboxSender {
  async function as<T>(userId: string, run: (client: ApiClient) => Promise<T>): Promise<T> {
    const auth = deps.auth()
    if (!auth) throw new IdentityMismatchError('no signed-in replayer: the write waits')
    const session: AuthSession | null = await auth.getSession()
    if (!session || session.userId !== userId) throw new IdentityMismatchError()
    try {
      return await run(deps.clientFor(session.accessToken))
    } catch (e) {
      const code = codeOf(e)
      if (code !== null && IDENTITY_SENSITIVE.has(code)) {
        const now = await auth.getSession().catch(() => null)
        if (!now || now.userId !== userId) throw new IdentityMismatchError()
      }
      throw e
    }
  }
  return {
    event: (id, body, userId) =>
      as(userId, (client) => client('sessionEvent', { params: { id }, body })),
    complete: (id, body, userId) =>
      as(userId, (client) => client('completeSession', { params: { id }, body })),
  }
}

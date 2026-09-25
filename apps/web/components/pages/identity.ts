/**
 * Identity switches for the account screens (ARCHITECTURE §10.2, §10.3): link an email to a guest,
 * sign in (merging the guest into the existing account), sign out.
 *
 * Before ANY switch the lesson outbox is flushed, so the guest's pending writes land under the guest
 * first (the outbox only sends entries of the signed-in user). If it can't deliver everything
 * (offline, server failing), the switch is refused with OUTBOX_BLOCKED_MESSAGE instead of stranding
 * the guest's lessons under an identity that is about to disappear.
 */
import type { HomeResponse } from '@zaboon/contracts'
import type { ApiClient } from '@/lib/api-client'
import type { AuthClient, AuthSession } from '@/lib/auth-client'
import type { FlushReport } from '@/lib/lesson/outbox'

export type FlushOutbox = () => Promise<FlushReport>

export const OUTBOX_BLOCKED_MESSAGE = 'Connect to the internet to save your progress first.'

export class OutboxBlockedError extends Error {
  constructor() {
    super(OUTBOX_BLOCKED_MESSAGE)
    this.name = 'OutboxBlockedError'
  }
}

/** Resolves when every pending lesson write of the current user was delivered (or dropped as invalid). */
export async function ensureOutboxDelivered(flush: FlushOutbox): Promise<void> {
  let report: FlushReport
  try {
    report = await flush()
  } catch {
    throw new OutboxBlockedError()
  }
  if (report.stalled || report.remaining > 0) throw new OutboxBlockedError()
}

export type SwitchResult =
  /** Now signed in as a member (the same user after a link; the existing account after a merge). */
  | { status: 'linked' }
  | { status: 'merged'; home: HomeResponse | null }
  /** Supabase mode: a confirmation link was emailed; the switch finishes when it is opened. */
  | { status: 'email_sent' }

interface Deps {
  auth: AuthClient
  api: ApiClient
  flush: FlushOutbox
}

// ------------------------------------------------------------------------ pending merge (email link)
/**
 * In Supabase mode signing in sends a magic link, so the merge can't run right away: the guest's
 * token waits here until the member session shows up (completePendingMerge).
 */
export const PENDING_MERGE_KEY = 'zaboon.pendingMerge'

interface PendingMerge {
  guestToken: string
  guestUserId: string
}

function savePendingMerge(p: PendingMerge): void {
  try {
    globalThis.localStorage?.setItem(PENDING_MERGE_KEY, JSON.stringify(p))
  } catch {
    // Storage unavailable: the guest's progress stays with the guest.
  }
}

function takePendingMerge(): PendingMerge | null {
  try {
    const raw = globalThis.localStorage?.getItem(PENDING_MERGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<PendingMerge>
    return typeof p.guestToken === 'string' && typeof p.guestUserId === 'string'
      ? { guestToken: p.guestToken, guestUserId: p.guestUserId }
      : null
  } catch {
    return null
  }
}

function clearPendingMerge(): void {
  try {
    globalThis.localStorage?.removeItem(PENDING_MERGE_KEY)
  } catch {
    // ignore
  }
}

/**
 * Finishes a merge started before an emailed sign-in link. Returns the merged home, or null when
 * there was nothing to do. A failed merge (the guest token expired) is dropped, not retried forever.
 */
export async function completePendingMerge({
  auth,
  api,
}: Pick<Deps, 'auth' | 'api'>): Promise<HomeResponse | null> {
  const pending = takePendingMerge()
  if (!pending) return null
  const session = await auth.getSession()
  if (!session || session.isAnonymous) return null
  if (session.userId === pending.guestUserId) {
    clearPendingMerge()
    return null
  }
  try {
    const res = await api('mergeAccount', { body: { guestToken: pending.guestToken } })
    return res.home
  } catch {
    return null
  } finally {
    clearPendingMerge()
  }
}

// ------------------------------------------------------------------------------------- switches
async function currentGuest(auth: AuthClient): Promise<AuthSession | null> {
  const s = await auth.getSession()
  return s && s.isAnonymous ? s : null
}

/**
 * Signs in with an email. A signed-in guest is merged into that account (their XP, streak days and
 * words carry over); without a guest it is a plain sign-in.
 */
export async function signInAndMerge(deps: Deps, email: string): Promise<SwitchResult> {
  const { auth, api } = deps
  await ensureOutboxDelivered(deps.flush)
  // Keep the guest's token: after the sign-in it is the only proof that we own the guest.
  const guest = await currentGuest(auth)
  const signIn = await auth.signInWithEmail(email)
  if (signIn.status === 'email_sent') {
    if (guest) savePendingMerge({ guestToken: guest.accessToken, guestUserId: guest.userId })
    return { status: 'email_sent' }
  }
  if (!guest || guest.userId === signIn.session.userId) return { status: 'merged', home: null }
  const res = await api('mergeAccount', { body: { guestToken: guest.accessToken } })
  return { status: 'merged', home: res.home }
}

/**
 * "Create a profile": adds an email to the guest (same user id). When the email already belongs to
 * an account, signs in to it and merges the guest into it (§10.3).
 */
export async function linkOrMerge(deps: Deps, email: string): Promise<SwitchResult> {
  const { auth } = deps
  await ensureOutboxDelivered(deps.flush)
  const link = await auth.linkEmail(email)
  if (link.status === 'signed_in') return { status: 'linked' }
  if (link.status === 'email_sent') return { status: 'email_sent' }
  // identity_already_exists: the outbox is already empty, so go straight to sign-in + merge.
  return signInAndMerge({ ...deps, flush: async () => emptyReport }, email)
}

const emptyReport: FlushReport = { delivered: 0, dropped: 0, stalled: false, remaining: 0 }

/** Signs out after the outbox is delivered. */
export async function signOutSafely(deps: Pick<Deps, 'auth' | 'flush'>): Promise<void> {
  await ensureOutboxDelivered(deps.flush)
  await deps.auth.signOut()
}

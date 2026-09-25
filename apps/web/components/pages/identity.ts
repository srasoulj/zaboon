/**
 * Identity switches for the account screens (ARCHITECTURE §10.2, §10.3): link an email to a guest,
 * sign in (merging the guest into the existing account), sign out.
 *
 * Before ANY switch the lesson outbox is flushed, so the guest's pending writes land under the guest
 * first (the outbox only sends entries of the signed-in user). If it can't deliver everything
 * (offline, server failing), the switch is refused with OUTBOX_BLOCKED_MESSAGE instead of stranding
 * the guest's lessons under an identity that is about to disappear. After a merge, anything still
 * queued for the guest is re-tagged to the account.
 */
import type { HomeResponse } from '@zaboon/contracts'
import type { ApiClient } from '@/lib/api-client'
import type { AuthClient, AuthSession } from '@/lib/auth-client'

/** What the identity switches need from the lesson outbox (components/lesson/services). */
export interface OutboxPort {
  /** Sends what it can; resolves to how many of `userId`'s entries are still waiting. */
  deliver(userId: string): Promise<number>
  /** Moves `fromUserId`'s queued entries to `toUserId` (after a guest merged into an account). */
  retag(fromUserId: string, toUserId: string): Promise<number>
  /** Removes what this device still holds for `userId` (after the account was deleted). */
  forget(userId: string): Promise<void>
}

export const OUTBOX_BLOCKED_MESSAGE = 'Connect to the internet to save your progress first.'

export class OutboxBlockedError extends Error {
  constructor() {
    super(OUTBOX_BLOCKED_MESSAGE)
    this.name = 'OutboxBlockedError'
  }
}

/**
 * Resolves when every pending lesson write of the signed-in user was delivered (or given up as
 * invalid). Other users' leftovers on this device don't block anything.
 */
export async function ensureOutboxDelivered(deps: Pick<Deps, 'auth' | 'outbox'>): Promise<void> {
  const session = await deps.auth.getSession()
  if (!session) return
  let waiting: number
  try {
    waiting = await deps.outbox.deliver(session.userId)
  } catch {
    throw new OutboxBlockedError()
  }
  if (waiting > 0) throw new OutboxBlockedError()
}

/** Re-tags the guest's queue after a merge; never fails the merge itself. */
async function retagAfterMerge(outbox: OutboxPort, guestUserId: string, accountUserId: string) {
  try {
    await outbox.retag(guestUserId, accountUserId)
  } catch {
    // The entries stay with the guest id; nothing is lost that the merge didn't already move.
  }
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
  outbox: OutboxPort
}

// ------------------------------------------------------------------------ pending merge (email link)
/**
 * In Supabase mode signing in sends a magic link, so the merge can't run right away: the guest's
 * token waits here until the member session shows up (completePendingMerge, run app-wide by the
 * providers' PendingMergeFinisher on every app load while a member is signed in). A local-mode
 * merge that fails for a transient reason is parked here too, so it is retried.
 *
 * The entry expires with the guest's token, is kept across transient failures (offline, 5xx, 429)
 * and is dropped, with a notice, only when the server refuses it for good.
 */
export const PENDING_MERGE_KEY = 'zaboon.pendingMerge'
/** Set when a pending merge had to be given up; the account screens show a notice. */
export const MERGE_DROPPED_KEY = 'zaboon.mergeDropped'

/** Errors after which retrying a merge can never succeed. */
const PERMANENT_MERGE_ERRORS: ReadonlySet<string> = new Set([
  'unauthorized',
  'forbidden',
  'validation',
])

function isPermanentMergeError(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null
  return typeof code === 'string' && PERMANENT_MERGE_ERRORS.has(code)
}

interface PendingMerge {
  guestToken: string
  guestUserId: string
  /** Epoch ms: the guest token's expiry; the entry is useless after it. */
  expiresAt: number
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function savePendingMerge(p: PendingMerge): void {
  try {
    storage()?.setItem(PENDING_MERGE_KEY, JSON.stringify(p))
  } catch {
    // Storage unavailable: the guest's progress stays with the guest.
  }
}

/**
 * Reads AND removes the entry in one synchronous step, so two concurrent callers (React StrictMode
 * runs effects twice) can never both merge it.
 */
function takePendingMerge(): PendingMerge | null {
  try {
    const store = storage()
    const raw = store?.getItem(PENDING_MERGE_KEY)
    if (!store || !raw) return null
    store.removeItem(PENDING_MERGE_KEY)
    const p = JSON.parse(raw) as Partial<PendingMerge>
    return typeof p.guestToken === 'string' &&
      typeof p.guestUserId === 'string' &&
      typeof p.expiresAt === 'number'
      ? { guestToken: p.guestToken, guestUserId: p.guestUserId, expiresAt: p.expiresAt }
      : null
  } catch {
    return null
  }
}

/** Puts a taken entry back for a later retry, unless a newer one was saved meanwhile. */
function restorePendingMerge(p: PendingMerge): void {
  if (storage()?.getItem(PENDING_MERGE_KEY)) return
  savePendingMerge(p)
}

/** Forgets any pending merge (sign-out, account deletion). */
export function clearPendingMerge(): void {
  try {
    storage()?.removeItem(PENDING_MERGE_KEY)
  } catch {
    // ignore
  }
}

function noteDroppedMerge(): void {
  try {
    storage()?.setItem(MERGE_DROPPED_KEY, '1')
  } catch {
    // ignore
  }
}

export function hasDroppedMerge(): boolean {
  try {
    return storage()?.getItem(MERGE_DROPPED_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissDroppedMerge(): void {
  try {
    storage()?.removeItem(MERGE_DROPPED_KEY)
  } catch {
    // ignore
  }
}

/**
 * Finishes a parked merge once a member session exists. Returns the merged home, or null when
 * there was nothing to do (or it failed: kept for a retry when the failure was transient).
 */
export async function completePendingMerge(
  { auth, api, outbox }: Deps,
  now: () => number = Date.now,
): Promise<HomeResponse | null> {
  const session = await auth.getSession()
  if (!session || session.isAnonymous) return null
  const pending = takePendingMerge()
  if (!pending) return null
  // The guest itself became this member (an email link): there is nothing to merge.
  if (session.userId === pending.guestUserId) return null
  if (pending.expiresAt <= now()) {
    noteDroppedMerge()
    return null
  }
  try {
    const res = await api('mergeAccount', { body: { guestToken: pending.guestToken } })
    await retagAfterMerge(outbox, pending.guestUserId, session.userId)
    return res.home
  } catch (error) {
    if (isPermanentMergeError(error)) noteDroppedMerge()
    else restorePendingMerge(pending)
    return null
  }
}

/** A sign-in that worked, followed by a merge that didn't. */
export class MergeFailedError extends Error {
  constructor(readonly willRetry: boolean) {
    super(
      willRetry
        ? "You're signed in, but we couldn't add your guest progress yet. We'll try again next time you open Zaboon."
        : "You're signed in, but your guest progress couldn't be added to this account.",
    )
    this.name = 'MergeFailedError'
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
  await ensureOutboxDelivered(deps)
  // Keep the guest's token: after the sign-in it is the only proof that we own the guest.
  const guest = await currentGuest(auth)
  const signIn = await auth.signInWithEmail(email)
  const parked = guest && {
    guestToken: guest.accessToken,
    guestUserId: guest.userId,
    expiresAt: guest.expiresAt,
  }
  if (signIn.status === 'email_sent') {
    if (parked) savePendingMerge(parked)
    return { status: 'email_sent' }
  }
  if (!parked || parked.guestUserId === signIn.session.userId)
    return { status: 'merged', home: null }
  let res
  try {
    res = await api('mergeAccount', { body: { guestToken: parked.guestToken } })
  } catch (error) {
    const willRetry = !isPermanentMergeError(error)
    if (willRetry) savePendingMerge(parked)
    throw new MergeFailedError(willRetry)
  }
  await retagAfterMerge(deps.outbox, parked.guestUserId, signIn.session.userId)
  return { status: 'merged', home: res.home }
}

/**
 * "Create a profile": adds an email to the guest (same user id). When the email already belongs to
 * an account, signs in to it and merges the guest into it (§10.3).
 */
export async function linkOrMerge(deps: Deps, email: string): Promise<SwitchResult> {
  const { auth } = deps
  await ensureOutboxDelivered(deps)
  const link = await auth.linkEmail(email)
  if (link.status === 'signed_in') return { status: 'linked' }
  if (link.status === 'email_sent') return { status: 'email_sent' }
  // identity_already_exists: still the guest, so the sign-in + merge path applies as is.
  return signInAndMerge(deps, email)
}

/**
 * Leaves the app for `href`, then signs out. The order matters: while an app screen is mounted, the
 * app shell signs any signed-out visitor in as a new guest, so signing out in place would create
 * a stray guest. The sign-out waits (up to `timeoutMs`) until the URL shows the new page.
 */
export async function leaveThenSignOut(
  deps: Pick<Deps, 'auth'> & {
    navigate: (href: string) => void
    currentPath: () => string
  },
  href = '/',
  timeoutMs = 5000,
): Promise<void> {
  deps.navigate(href)
  const deadline = Date.now() + timeoutMs
  while (deps.currentPath() !== href && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 25))
  // A parked guest token must not outlive the session that parked it.
  clearPendingMerge()
  await deps.auth.signOut()
}

/** Signs out after the outbox is delivered, from the home page (see leaveThenSignOut). */
export async function signOutSafely(
  deps: Pick<Deps, 'auth' | 'outbox'> & {
    navigate: (href: string) => void
    currentPath: () => string
  },
): Promise<void> {
  await ensureOutboxDelivered(deps)
  await leaveThenSignOut(deps)
}

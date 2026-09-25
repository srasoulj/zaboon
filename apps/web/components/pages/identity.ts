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
 * Lifecycle: the entry is read, never taken, while its request runs, and is removed only when the
 * merge succeeded, was refused for good (with a notice) or expired with the guest's token. A tab
 * that dies mid-request therefore loses nothing. Runs are serialized per device with the Web Locks
 * API (a single-flight promise where it is missing; the server merge is idempotent anyway). The
 * entry carries a nonce: after a request, storage is only touched if the same entry is still there,
 * so a sign-out, an account deletion or a newer save during the request always wins.
 */
export const PENDING_MERGE_KEY = 'zaboon.pendingMerge'
/** `{ userId }` of the member whose pending merge had to be given up (MergeDroppedNotice). */
export const MERGE_DROPPED_KEY = 'zaboon.mergeDropped'
/** Dispatched on window whenever MERGE_DROPPED_KEY changes in this tab. */
export const MERGE_DROPPED_EVENT = 'zaboon:merge-dropped'

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
  /** Identifies this entry: a request only settles the entry it started with. */
  nonce: string
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function newNonce(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function savePendingMerge(p: Omit<PendingMerge, 'nonce'>): void {
  try {
    storage()?.setItem(PENDING_MERGE_KEY, JSON.stringify({ ...p, nonce: newNonce() }))
  } catch {
    // Storage unavailable: the guest's progress stays with the guest.
  }
}

function readPendingMerge(): PendingMerge | null {
  try {
    const raw = storage()?.getItem(PENDING_MERGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<PendingMerge>
    return typeof p.guestToken === 'string' &&
      typeof p.guestUserId === 'string' &&
      typeof p.expiresAt === 'number' &&
      typeof p.nonce === 'string'
      ? {
          guestToken: p.guestToken,
          guestUserId: p.guestUserId,
          expiresAt: p.expiresAt,
          nonce: p.nonce,
        }
      : null
  } catch {
    return null
  }
}

/** Removes the entry if it is still the one with `nonce`; true when it was. */
function settlePendingMerge(nonce: string): boolean {
  if (readPendingMerge()?.nonce !== nonce) return false
  clearPendingMerge()
  return true
}

/** Forgets any pending merge (sign-out, account deletion). */
export function clearPendingMerge(): void {
  try {
    storage()?.removeItem(PENDING_MERGE_KEY)
  } catch {
    // ignore
  }
}

function setDropped(value: string | null): void {
  try {
    if (value === null) storage()?.removeItem(MERGE_DROPPED_KEY)
    else storage()?.setItem(MERGE_DROPPED_KEY, value)
  } catch {
    // ignore
  }
  // The `storage` event only reaches other tabs; this tab listens for this one.
  globalThis.dispatchEvent?.(new Event(MERGE_DROPPED_EVENT))
}

function noteDroppedMerge(userId: string): void {
  setDropped(JSON.stringify({ userId }))
}

/** The member a dropped merge concerns, if any. */
export function droppedMergeFor(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as { userId?: unknown }
    return typeof v.userId === 'string' ? v.userId : null
  } catch {
    return null
  }
}

export function readDroppedMerge(): string | null {
  try {
    return storage()?.getItem(MERGE_DROPPED_KEY) ?? null
  } catch {
    return null
  }
}

/** Hides the notice (dismissed, signed out or deleted). */
export function clearDroppedMerge(): void {
  setDropped(null)
}

// Serialization of merge runs on this device.
interface LockManagerLike {
  request<T>(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<T>,
  ): Promise<T>
}
let singleFlight: Promise<HomeResponse | null> | null = null

function lockManager(): LockManagerLike | null {
  const locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks
  return locks && typeof locks.request === 'function' ? locks : null
}

/** Runs `fn` unless another merge run holds the lock (then does nothing and resolves null). */
async function exclusively(fn: () => Promise<HomeResponse | null>): Promise<HomeResponse | null> {
  const locks = lockManager()
  if (locks)
    return locks.request(PENDING_MERGE_KEY, { ifAvailable: true }, async (lock) =>
      lock ? fn() : null,
    )
  if (singleFlight) return null
  singleFlight = fn().finally(() => {
    singleFlight = null
  })
  return singleFlight
}

/**
 * Finishes a parked merge once a member session exists. Returns the merged home, or null when
 * there was nothing to do, another run was in progress, or it failed (kept for the next load when
 * the failure was transient).
 */
export async function completePendingMerge(
  { auth, api, outbox }: Deps,
  now: () => number = Date.now,
): Promise<HomeResponse | null> {
  const session = await auth.getSession()
  if (!session || session.isAnonymous) return null
  const member = session.userId
  return exclusively(async () => {
    const pending = readPendingMerge()
    if (!pending) return null
    // The guest itself became this member (an email link): there is nothing to merge.
    if (member === pending.guestUserId) {
      settlePendingMerge(pending.nonce)
      return null
    }
    if (pending.expiresAt <= now()) {
      if (settlePendingMerge(pending.nonce)) noteDroppedMerge(member)
      return null
    }
    try {
      const res = await api('mergeAccount', { body: { guestToken: pending.guestToken } })
      settlePendingMerge(pending.nonce)
      await retagAfterMerge(outbox, pending.guestUserId, member)
      return res.home
    } catch (error) {
      // Transient: the entry was never removed, so the next app load retries it. Nothing is ever
      // written back, so a sign-out during the request stays a sign-out.
      if (isPermanentMergeError(error) && settlePendingMerge(pending.nonce))
        noteDroppedMerge(member)
      return null
    }
  })
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
  // A parked guest token, and a notice meant for this member, must not outlive the session.
  clearPendingMerge()
  clearDroppedMerge()
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

/**
 * Browser auth (orchestrator-owned). ADR 0009: the browser uses Supabase ONLY for Auth; in
 * AUTH_MODE=local the same interface talks to the dev endpoints (/api/dev/auth/*).
 * Select the mode at build time with NEXT_PUBLIC_AUTH_MODE ('local' | 'supabase').
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { DevTokenResponse } from '@zaboon/contracts'

export type AuthMode = 'local' | 'supabase'

export interface AuthSession {
  accessToken: string
  /** Epoch milliseconds. */
  expiresAt: number
  userId: string
  isAnonymous: boolean
  email: string | null
}

export type SignInResult = { status: 'signed_in'; session: AuthSession } | { status: 'email_sent' }
export type LinkResult = SignInResult | { status: 'identity_already_exists' }

export interface AuthClient {
  readonly mode: AuthMode
  /** The current session, refreshed when it is about to expire; null when signed out. */
  getSession(): Promise<AuthSession | null>
  /** Signs in as a new anonymous guest (Supabase anonymous sign-in). */
  signInAsGuest(): Promise<AuthSession>
  /** Email sign-in: local mode signs in at once; Supabase sends a one-time link. */
  signInWithEmail(email: string): Promise<SignInResult>
  /** Adds an email to the current guest; `identity_already_exists` starts the merge flow. */
  linkEmail(email: string): Promise<LinkResult>
  signOut(): Promise<void>
  subscribe(listener: (session: AuthSession | null) => void): () => void
}

export const LOCAL_SESSION_KEY = 'zaboon.session'
const REFRESH_MARGIN_MS = 60_000

function readStored(): AuthSession | null {
  try {
    const raw = globalThis.localStorage?.getItem(LOCAL_SESSION_KEY)
    return raw ? (JSON.parse(raw) as AuthSession) : null
  } catch {
    return null
  }
}

function writeStored(session: AuthSession | null): void {
  try {
    if (session) globalThis.localStorage?.setItem(LOCAL_SESSION_KEY, JSON.stringify(session))
    else globalThis.localStorage?.removeItem(LOCAL_SESSION_KEY)
  } catch {
    // Storage can be unavailable (private mode); the session then lasts for this page only.
  }
}

/** Local dev auth against /api/dev/auth/* (tokens mirror Supabase's). */
export function createLocalAuthClient(fetchImpl: typeof fetch = (...a) => fetch(...a)): AuthClient {
  let current: AuthSession | null = readStored()
  const listeners = new Set<(s: AuthSession | null) => void>()
  const set = (s: AuthSession | null) => {
    current = s
    writeStored(s)
    for (const l of listeners) l(s)
  }
  async function post(path: string, body?: unknown, token?: string): Promise<Response> {
    return fetchImpl(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }
  async function toSession(res: Response): Promise<AuthSession> {
    if (!res.ok) throw new Error(`dev auth failed (${res.status})`)
    const t = DevTokenResponse.parse(await res.json())
    return {
      accessToken: t.accessToken,
      expiresAt: Date.parse(t.expiresAt),
      userId: t.user.id,
      isAnonymous: t.user.isAnonymous,
      email: t.user.email,
    }
  }
  let refreshing: Promise<AuthSession | null> | null = null
  return {
    mode: 'local',
    async getSession() {
      if (!current) current = readStored()
      if (!current) return null
      if (current.expiresAt - Date.now() > REFRESH_MARGIN_MS) return current
      refreshing ??= (async () => {
        try {
          const res = await post('/api/dev/auth/refresh', { accessToken: current!.accessToken })
          if (res.status === 401) {
            set(null)
            return null
          }
          const s = await toSession(res)
          set(s)
          return s
        } finally {
          refreshing = null
        }
      })()
      return refreshing
    },
    async signInAsGuest() {
      const s = await toSession(await post('/api/dev/auth/anonymous'))
      set(s)
      return s
    },
    async signInWithEmail(email) {
      const s = await toSession(await post('/api/dev/auth/sign-in', { email }))
      set(s)
      return { status: 'signed_in', session: s }
    },
    async linkEmail(email) {
      const session = await this.getSession()
      if (!session) throw new Error('not signed in')
      const res = await post('/api/dev/auth/link', { email }, session.accessToken)
      if (res.status === 409) return { status: 'identity_already_exists' }
      const s = await toSession(res)
      set(s)
      return { status: 'signed_in', session: s }
    },
    async signOut() {
      set(null)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** Production auth: supabase-js, used for Auth only (never for data). */
export function createSupabaseAuthClient(url: string, publishableKey: string): AuthClient {
  const supabase: SupabaseClient = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  const toSession = (s: {
    access_token: string
    expires_at?: number | undefined
    user: { id: string; is_anonymous?: boolean | undefined; email?: string | undefined }
  }): AuthSession => ({
    accessToken: s.access_token,
    expiresAt: (s.expires_at ?? 0) * 1000,
    userId: s.user.id,
    isAnonymous: s.user.is_anonymous === true,
    email: s.user.email || null,
  })
  return {
    mode: 'supabase',
    async getSession() {
      const { data } = await supabase.auth.getSession()
      return data.session ? toSession(data.session) : null
    },
    async signInAsGuest() {
      const { data, error } = await supabase.auth.signInAnonymously()
      if (error || !data.session) throw error ?? new Error('anonymous sign-in failed')
      return toSession(data.session)
    },
    async signInWithEmail(email) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/learn` },
      })
      if (error) throw error
      return { status: 'email_sent' }
    },
    async linkEmail(email) {
      const { error } = await supabase.auth.updateUser({ email })
      if (error) {
        if (error.code === 'email_exists' || error.code === 'identity_already_exists') {
          return { status: 'identity_already_exists' }
        }
        throw error
      }
      return { status: 'email_sent' }
    },
    async signOut() {
      await supabase.auth.signOut()
    },
    subscribe(listener) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) =>
        listener(session ? toSession(session) : null),
      )
      return () => data.subscription.unsubscribe()
    },
  }
}

/**
 * Builds the real client at the first auth call. Providers create the auth client while rendering,
 * and rendering also happens on the server (static prerendering at `next build` included), where the
 * browser's Supabase configuration need not exist and nothing calls auth.
 */
function lazyAuthClient(mode: AuthMode, build: () => AuthClient): AuthClient {
  let real: AuthClient | undefined
  const client = () => (real ??= build())
  return {
    mode,
    getSession: async () => client().getSession(),
    signInAsGuest: async () => client().signInAsGuest(),
    signInWithEmail: async (email) => client().signInWithEmail(email),
    linkEmail: async (email) => client().linkEmail(email),
    signOut: async () => client().signOut(),
    subscribe: (listener) => client().subscribe(listener),
  }
}

export function createAuthClient(): AuthClient {
  if (process.env.NEXT_PUBLIC_AUTH_MODE === 'local') return createLocalAuthClient()
  return lazyAuthClient('supabase', () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    if (!url || !key)
      throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set')
    return createSupabaseAuthClient(url, key)
  })
}

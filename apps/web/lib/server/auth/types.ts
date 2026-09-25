/** The signed-in caller, from a verified access token (Supabase in production, local in dev). */
export interface AuthUser {
  id: string
  isAnonymous: boolean
  email: string | null
  isAdmin: boolean
}

/** The subset of Supabase access-token claims the API relies on (local tokens mirror them). */
export interface AccessClaims {
  sub: string
  role: string
  aud: string | string[]
  is_anonymous?: boolean
  email?: string
  app_metadata?: { role?: string; provider?: string; providers?: string[] }
}

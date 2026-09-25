/**
 * Privileged auth operations (account deletion). Production calls the Supabase Admin API with the
 * server-only SUPABASE_SECRET_KEY; local mode uses the dev user store.
 */
import { serverEnv } from '../env'
import { ApiError } from '../errors'
import { deleteUser as deleteLocalUser } from './dev-users'

export interface AuthAdmin {
  /** Deletes the auth user; database rows cascade from auth.users. Returns false if already gone. */
  deleteUser(userId: string): Promise<boolean>
}

const supabaseAdmin = (supabaseUrl: string, secretKey: string): AuthAdmin => ({
  async deleteUser(userId) {
    const res = await fetch(
      `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        headers: { apikey: secretKey, authorization: `Bearer ${secretKey}` },
      },
    )
    if (res.status === 404) return false
    if (!res.ok) throw new ApiError('internal', `auth admin delete failed (${res.status})`)
    return true
  },
})

export function authAdmin(): AuthAdmin {
  const env = serverEnv()
  if (env.authMode === 'local') {
    if (!env.devAuth)
      throw new ApiError('internal', 'account deletion in local mode needs ZABOON_DEV_AUTH=1')
    return { deleteUser: deleteLocalUser }
  }
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!secretKey) throw new ApiError('internal', 'SUPABASE_SECRET_KEY is not set')
  return supabaseAdmin(env.supabaseUrl!, secretKey)
}

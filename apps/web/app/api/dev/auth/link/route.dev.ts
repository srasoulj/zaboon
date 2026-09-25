// Dev only: compiled when ZABOON_DEV_AUTH=1 (next.config pageExtensions), served only in AUTH_MODE=local.
// Emulates Supabase `updateUser({ email })` on an anonymous user, including identity_already_exists.
import { routes } from '@zaboon/contracts'
import { linkEmail } from '@/lib/server/auth/dev-users'
import { signLocalToken } from '@/lib/server/auth/local'
import { ApiError } from '@/lib/server/errors'
import { withRoute } from '@/lib/server/with-route'

export const POST = withRoute(routes.devLink, async ({ body, user, now }) => {
  if (!user) throw new ApiError('unauthorized', 'sign-in required')
  const linked = await linkEmail(user.id, body.email)
  const { accessToken, expiresAt } = await signLocalToken({ ...linked, userId: linked.id, now })
  return {
    accessToken,
    expiresAt: expiresAt.toISOString(),
    user: { id: linked.id, isAnonymous: linked.isAnonymous, email: linked.email },
  }
})

// Dev only: compiled when ZABOON_DEV_AUTH=1 (next.config pageExtensions), served only in AUTH_MODE=local.
// Stands in for Supabase's refresh token: a signed (possibly expired, up to 30 days) local token is
// exchanged for a fresh one carrying the user's current claims.
import { routes } from '@zaboon/contracts'
import { userFromClaims } from '@/lib/server/auth/claims'
import { getUser } from '@/lib/server/auth/dev-users'
import {
  LOCAL_REFRESH_WINDOW_SECONDS,
  signLocalToken,
  verifyLocalToken,
} from '@/lib/server/auth/local'
import { ApiError } from '@/lib/server/errors'
import { withRoute } from '@/lib/server/with-route'

export const POST = withRoute(routes.devRefresh, async ({ body, now }) => {
  const claims = await verifyLocalToken(body.accessToken, {
    allowExpiredForSeconds: LOCAL_REFRESH_WINDOW_SECONDS,
  })
  const user = await getUser(userFromClaims(claims).id)
  if (!user) throw new ApiError('unauthorized', 'user no longer exists')
  const { accessToken, expiresAt } = await signLocalToken({ ...user, userId: user.id, now })
  return {
    accessToken,
    expiresAt: expiresAt.toISOString(),
    user: { id: user.id, isAnonymous: user.isAnonymous, email: user.email },
  }
})

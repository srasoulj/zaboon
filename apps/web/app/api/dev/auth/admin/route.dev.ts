// Dev only: compiled when ZABOON_DEV_AUTH=1 (next.config pageExtensions), served only in AUTH_MODE=local.
import { routes } from '@zaboon/contracts'
import { createAdminUser } from '@/lib/server/auth/dev-users'
import { signLocalToken } from '@/lib/server/auth/local'
import { withRoute } from '@/lib/server/with-route'

export const POST = withRoute(routes.devAdmin, async ({ now }) => {
  const user = await createAdminUser()
  const { accessToken, expiresAt } = await signLocalToken({ ...user, userId: user.id, now })
  return {
    accessToken,
    expiresAt: expiresAt.toISOString(),
    user: { id: user.id, isAnonymous: false, email: user.email },
  }
})

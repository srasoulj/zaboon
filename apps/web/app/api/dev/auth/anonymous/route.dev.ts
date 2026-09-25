// Dev only: compiled when ZABOON_DEV_AUTH=1 (next.config pageExtensions), served only in AUTH_MODE=local.
import { routes } from '@zaboon/contracts'
import { createAnonymousUser } from '@/lib/server/auth/dev-users'
import { signLocalToken } from '@/lib/server/auth/local'
import { withRoute } from '@/lib/server/with-route'

export const POST = withRoute(routes.devAnonymous, async ({ now }) => {
  const user = await createAnonymousUser()
  const { accessToken, expiresAt } = await signLocalToken({
    userId: user.id,
    isAnonymous: true,
    email: null,
    now,
  })
  return {
    accessToken,
    expiresAt: expiresAt.toISOString(),
    user: { id: user.id, isAnonymous: true, email: null },
  }
})

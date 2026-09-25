import { routes } from '@zaboon/contracts'
import { buildHome } from '../../../lib/server/home'
import { onboard } from '../../../lib/server/profile'
import { withRoute } from '../../../lib/server/with-route'

export const POST = withRoute(routes.onboarding, async ({ db, user, now, config, flags, body }) => {
  await onboard({ db, user, now, config }, body)
  return buildHome(db, user, now, config, flags)
})

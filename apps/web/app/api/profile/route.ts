import { routes } from '@zaboon/contracts'
import { getProfile, updateProfile } from '../../../lib/server/profile'
import { withRoute } from '../../../lib/server/with-route'

export const GET = withRoute(routes.profile, ({ db, user, now, config }) =>
  getProfile({ db, user, now, config }),
)

export const PATCH = withRoute(routes.updateProfile, ({ db, user, now, config, body }) =>
  updateProfile({ db, user, now, config }, body),
)

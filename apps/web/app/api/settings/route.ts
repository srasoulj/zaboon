import { routes } from '@zaboon/contracts'
import { getSettings, updateSettings } from '../../../lib/server/profile'
import { withRoute } from '../../../lib/server/with-route'

export const GET = withRoute(routes.settings, ({ db, user, now, config }) =>
  getSettings({ db, user, now, config }),
)

export const PATCH = withRoute(routes.updateSettings, ({ db, user, now, config, body }) =>
  updateSettings({ db, user, now, config }, body),
)

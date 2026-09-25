import { routes } from '@zaboon/contracts'
import { buildHome } from '../../../lib/server/home'
import { withRoute } from '../../../lib/server/with-route'

export const GET = withRoute(routes.home, ({ db, user, now, config, flags }) =>
  buildHome(db, user, now, config, flags),
)

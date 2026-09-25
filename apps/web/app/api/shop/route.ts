import { routes } from '@zaboon/contracts'
import { requireFlag } from '../../../lib/server/engagement/flags'
import { buildShop } from '../../../lib/server/engagement/shop'
import { withRoute } from '../../../lib/server/with-route'

/** GET /api/shop (flags.shop): the coin balance and what it can buy now. */
export const GET = withRoute(routes.shop, ({ db, user, now, config, flags }) => {
  requireFlag(flags, 'shop')
  return buildShop(db, user.id, now, config)
})

import { routes } from '@zaboon/contracts'
import { requireFlag } from '../../../../lib/server/engagement/flags'
import { buy } from '../../../../lib/server/engagement/shop'
import { withRoute } from '../../../../lib/server/with-route'

/** POST /api/shop/purchase (flags.shop): buys one item, idempotent by purchaseId. */
export const POST = withRoute(routes.purchase, ({ db, user, now, config, flags, body }) => {
  requireFlag(flags, 'shop')
  return buy(db, user.id, body, now, config)
})

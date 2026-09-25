import { routes } from '@zaboon/contracts'
import { requireFlag } from '../../../../lib/server/engagement/flags'
import { buy } from '../../../../lib/server/engagement/shop'
import { withRoute } from '../../../../lib/server/with-route'

/** POST /api/lives/refill (flags.shop): buys a heart refill, idempotent by purchaseId. */
export const POST = withRoute(routes.refillLives, ({ db, user, now, config, flags, body }) => {
  requireFlag(flags, 'shop')
  return buy(db, user.id, { item: 'heart_refill', purchaseId: body.purchaseId }, now, config)
})

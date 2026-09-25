import { routes } from '@zaboon/contracts'
import { mergeAccounts } from '../../../../lib/server/account'
import { buildHome } from '../../../../lib/server/home'
import { withRoute } from '../../../../lib/server/with-route'

export const POST = withRoute(routes.mergeAccount, async ({ db, user, now, config, flags, body }) => {
  const { merged } = await mergeAccounts({ db, user, now, config }, body.guestToken)
  return { merged, home: await buildHome(db, user, now, config, flags) }
})

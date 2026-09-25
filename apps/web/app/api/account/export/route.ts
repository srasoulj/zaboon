import { routes } from '@zaboon/contracts'
import { exportAccount } from '../../../../lib/server/account'
import { withRoute } from '../../../../lib/server/with-route'

export const GET = withRoute(routes.exportAccount, ({ db, user, now, config }) =>
  exportAccount({ db, user, now, config }),
)

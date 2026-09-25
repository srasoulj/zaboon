import { routes } from '@zaboon/contracts'
import { deleteAccount } from '../../../lib/server/account'
import { withRoute } from '../../../lib/server/with-route'

export const DELETE = withRoute(routes.deleteAccount, ({ db, user, now, config }) =>
  deleteAccount({ db, user, now, config }),
)

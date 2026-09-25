import { routes } from '@zaboon/contracts'
import { completeSession } from '../../../../../lib/server/sessions'
import { withRoute } from '../../../../../lib/server/with-route'

export const POST = withRoute(
  routes.completeSession,
  ({ db, user, now, config, flags, body, params }) =>
    completeSession({ db, user, now, config, flags }, params.id ?? '', body),
)

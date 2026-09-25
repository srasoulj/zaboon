import { routes } from '@zaboon/contracts'
import { completeSession } from '@/lib/server/sessions'
import { withRoute } from '@/lib/server/with-route'

export const POST = withRoute(routes.completeSession, ({ db, user, now, config, body, params }) =>
  completeSession({ db, user, now, config }, params.id ?? '', body),
)

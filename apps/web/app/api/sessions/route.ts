import { routes } from '@zaboon/contracts'
import { createSession } from '@/lib/server/sessions'
import { withRoute } from '@/lib/server/with-route'

export const POST = withRoute(routes.createSession, ({ db, user, now, config, body }) =>
  createSession({ db, user, now, config }, body),
)

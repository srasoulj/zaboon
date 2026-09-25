import { routes } from '@zaboon/contracts'
import { buildWords, courseParam } from '../../../lib/server/catalog'
import { withRoute } from '../../../lib/server/with-route'

export const GET = withRoute(routes.words, ({ db, user, req, now, config }) =>
  buildWords({ db, userId: user.id, courseId: courseParam(req), now, config }),
)

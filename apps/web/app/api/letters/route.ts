import { routes } from '@zaboon/contracts'
import { buildLetters, courseParam } from '../../../lib/server/catalog'
import { withRoute } from '../../../lib/server/with-route'

export const GET = withRoute(routes.letters, ({ db, user, req, now, config }) =>
  buildLetters({ db, userId: user.id, courseId: courseParam(req), now, config }),
)

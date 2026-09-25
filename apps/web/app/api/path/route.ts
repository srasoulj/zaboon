import { routes } from '@zaboon/contracts'
import { buildPath, courseParam } from '../../../lib/server/catalog'
import { withRoute } from '../../../lib/server/with-route'

/** The learning path of the active course (or `?courseId=`), at the current content version. */
export const GET = withRoute(routes.path, ({ db, user, req }) =>
  buildPath({ db, userId: user.id, courseId: courseParam(req) }),
)

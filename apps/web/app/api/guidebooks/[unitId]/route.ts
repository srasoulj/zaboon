import { routes } from '@zaboon/contracts'
import { courseParam } from '../../../../lib/server/catalog'
import { buildGuidebook } from '../../../../lib/server/guidebook'
import { withRoute } from '../../../../lib/server/with-route'

/** A unit's Guidebook for the active course (or `?courseId=`), with resolved audio URLs. */
export const GET = withRoute(routes.guidebook, ({ db, user, req, params }) =>
  buildGuidebook({ db, userId: user.id, courseId: courseParam(req), unitId: params.unitId ?? '' }),
)

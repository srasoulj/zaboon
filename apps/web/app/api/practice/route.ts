import { routes } from '@zaboon/contracts'
import { requireFlag } from '../../../lib/server/engagement/flags'
import { buildPractice } from '../../../lib/server/engagement/practice'
import { withRoute } from '../../../lib/server/with-route'

/** GET /api/practice (flags.practiceHub): the practice modes the learner can start. */
export const GET = withRoute(routes.practice, ({ db, user, now, flags }) => {
  requireFlag(flags, 'practiceHub')
  return buildPractice(db, user.id, now, flags)
})

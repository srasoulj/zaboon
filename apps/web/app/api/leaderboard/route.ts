import { routes } from '@zaboon/contracts'
import { withUser } from '@zaboon/db'
import { requireFlag } from '../../../lib/server/engagement/flags'
import { buildLeaderboard } from '../../../lib/server/engagement/leagues'
import { withRoute } from '../../../lib/server/with-route'

/** GET /api/leaderboard (members; flags.leagues): the learner's own cohort this week. */
export const GET = withRoute(routes.leaderboard, ({ db, user, now, config, flags }) => {
  requireFlag(flags, 'leagues')
  return withUser(db, user.id, (tx) => buildLeaderboard(tx, user.id, now, config))
})

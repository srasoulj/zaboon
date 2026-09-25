import { routes } from '@zaboon/contracts'
import { repos, withUser } from '@zaboon/db'
import { dateInZone, nextLocalMidnight } from '@zaboon/game-rules'
import { requireFlag } from '../../../lib/server/engagement/flags'
import { readQuests } from '../../../lib/server/engagement/quests'
import { withRoute } from '../../../lib/server/with-route'

/** GET /api/quests (flags.quests): today's quests in the learner's profile timezone. */
export const GET = withRoute(routes.quests, ({ db, user, now, config, flags }) => {
  requireFlag(flags, 'quests')
  return withUser(db, user.id, async (tx) => {
    const tz = (await repos.profiles.getProfile(tx, user.id))?.timezone ?? 'UTC'
    const date = dateInZone(now, tz)
    return {
      date,
      resetsAt: nextLocalMidnight(now, tz),
      quests: await readQuests(tx, user.id, date, config),
    }
  })
})

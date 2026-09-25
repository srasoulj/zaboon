import { routes } from '@zaboon/contracts'
import { runRollover } from '../../../../lib/server/engagement/rollover'
import { withRoute } from '../../../../lib/server/with-route'

/**
 * GET /api/cron/league-rollover (Vercel Cron, Mondays 00:00 UTC, `Authorization: Bearer
 * $CRON_SECRET`; apps/web/vercel.json). Runs whatever the flags say: with leagues off there is
 * nothing to close.
 */
export const GET = withRoute(routes.leagueRollover, ({ db, now, config }) =>
  runRollover(db, now, config),
)

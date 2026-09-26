import { routes } from '@zaboon/contracts'
import { transcribe } from '../../../../lib/server/speech/transcribe'
import { withRoute } from '../../../../lib/server/with-route'

/**
 * POST /api/speech/transcribe (flags.speak): one recording of a speak challenge in the caller's
 * open session → transcript + signed token. The audio is never stored.
 */
export const POST = withRoute(routes.transcribe, ({ db, user, now, config, flags, body }) =>
  transcribe({ db, user, now, config, flags }, body),
)

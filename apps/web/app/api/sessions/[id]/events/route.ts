import { routes } from '@zaboon/contracts'
import { recordWrongAttempt } from '../../../../../lib/server/sessions'
import { withRoute } from '../../../../../lib/server/with-route'

export const POST = withRoute(routes.sessionEvent, ({ db, user, now, config, body, params }) =>
  recordWrongAttempt({ db, user, now, config }, params.id ?? '', body),
)

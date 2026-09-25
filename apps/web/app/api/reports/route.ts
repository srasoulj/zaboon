import { routes } from '@zaboon/contracts'
import { createReport } from '../../../lib/server/reports'
import { withRoute } from '../../../lib/server/with-route'

export const POST = withRoute(routes.createReport, ({ db, user, body }) =>
  createReport(db, user.id, body),
)

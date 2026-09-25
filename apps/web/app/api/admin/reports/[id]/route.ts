import { routes } from '@zaboon/contracts'
import { updateReport } from '../../../../../lib/server/reports'
import { withRoute } from '../../../../../lib/server/with-route'

export const PATCH = withRoute(routes.adminUpdateReport, ({ db, body, params }) =>
  updateReport(db, params.id ?? '', body.status),
)

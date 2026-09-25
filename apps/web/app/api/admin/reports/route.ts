import { routes } from '@zaboon/contracts'
import { listReports } from '../../../../lib/server/reports'
import { withRoute } from '../../../../lib/server/with-route'

export const GET = withRoute(routes.adminReports, ({ db, req }) => listReports(db, req))

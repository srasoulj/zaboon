import { DEFAULT_COURSE_ID, routes } from '@zaboon/contracts'
import { GRADER_VERSION } from '@zaboon/grader'
import { requireCurrentVersion } from '../../../lib/server/content'
import { serverEnv } from '../../../lib/server/env'
import { withRoute } from '../../../lib/server/with-route'

export const GET = withRoute(routes.meta, async ({ db, config, flags }) => {
  const cv = await requireCurrentVersion(db, DEFAULT_COURSE_ID)
  const oldest = Math.max(1, GRADER_VERSION - config.graderWindow + 1)
  return {
    contentVersion: cv.version,
    minAppVersion: config.minAppVersion,
    graderVersions: Array.from({ length: GRADER_VERSION - oldest + 1 }, (_, i) => oldest + i),
    flags,
    authMode: serverEnv().authMode,
  }
})

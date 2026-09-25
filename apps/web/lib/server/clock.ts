import { TEST_NOW_HEADER } from '@zaboon/contracts'
import { serverEnv } from './env'
import { ApiError } from './errors'

/**
 * The request's "now" (the Clock seam of ADR 0009). In AUTH_MODE=local an `x-test-now` header
 * (an ISO instant) sets it, so tests can time-travel; production ignores the header.
 */
export function requestNow(req: Request): Date {
  if (serverEnv().authMode === 'local') {
    const header = req.headers.get(TEST_NOW_HEADER)
    if (header) {
      const at = new Date(header)
      if (Number.isNaN(at.getTime()))
        throw new ApiError('validation', `invalid ${TEST_NOW_HEADER} header`)
      return at
    }
  }
  return new Date()
}

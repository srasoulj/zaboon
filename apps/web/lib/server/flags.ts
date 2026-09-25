import { FLAG_DEFAULTS, TEST_FLAGS_HEADER } from '@zaboon/contracts'
import { serverEnv } from './env'
import { ApiError } from './errors'

/**
 * The request's feature flags (orchestrator-owned): the configured flags (FLAG_DEFAULTS +
 * app_config), plus, in AUTH_MODE=local only, the overrides in the `x-test-flags` header (a JSON
 * object of known flag names → booleans), so tests can switch a feature on for one request.
 * Production ignores the header, like `x-test-now` (clock.ts).
 */
export function requestFlags(
  req: Request,
  configured: Readonly<Record<string, boolean>>,
): Record<string, boolean> {
  if (serverEnv().authMode !== 'local') return { ...configured }
  const header = req.headers.get(TEST_FLAGS_HEADER)
  if (header === null || header.trim() === '') return { ...configured }
  return { ...configured, ...parseTestFlags(header, configured) }
}

/** Parses an `x-test-flags` value; a malformed value or an unknown flag is a 400. */
export function parseTestFlags(
  header: string,
  configured: Readonly<Record<string, boolean>> = {},
): Record<string, boolean> {
  let raw: unknown
  try {
    raw = JSON.parse(header)
  } catch {
    throw new ApiError('validation', `invalid ${TEST_FLAGS_HEADER} header: not JSON`)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new ApiError('validation', `invalid ${TEST_FLAGS_HEADER} header: expected an object`)
  const out: Record<string, boolean> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (!Object.hasOwn(FLAG_DEFAULTS, name) && !Object.hasOwn(configured, name))
      throw new ApiError('validation', `unknown flag "${name}" in ${TEST_FLAGS_HEADER}`)
    if (typeof value !== 'boolean')
      throw new ApiError('validation', `flag "${name}" in ${TEST_FLAGS_HEADER} must be a boolean`)
    out[name] = value
  }
  return out
}

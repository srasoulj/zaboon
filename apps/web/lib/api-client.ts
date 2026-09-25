/**
 * Typed API client (orchestrator-owned): one function for every route in the contract registry.
 *
 *   const home = await api('home')
 *   const s = await api('createSession', { body: { courseId, kind: 'lesson', levelId, tz } })
 *   await api('completeSession', { params: { id }, body })
 *   const reports = await api('adminReports', { query: { status: 'open' } })
 *
 * Responses are validated against the same zod contracts the server uses. Errors become
 * `ApiClientError` with the contract's error code.
 */
import {
  APP_VERSION_HEADER,
  buildPath,
  ErrorEnvelope,
  routes,
  TEST_FLAGS_HEADER,
  TEST_NOW_HEADER,
  type ErrorCode,
  type RouteName,
  type RouteRequest,
  type RouteResponse,
} from '@zaboon/contracts'

export const APP_VERSION = '0.1.0'
/** Local-mode time travel for UI tests: a stored ISO instant sent as `x-test-now`. */
export const TEST_NOW_KEY = 'zaboon.testNow'
/**
 * Local-mode feature flags for UI tests: a stored JSON object of flag overrides (e.g.
 * `{"shop":true}`) sent as `x-test-flags` (e2e: `setTestFlags(page, flags)` in e2e/fixtures).
 */
export const TEST_FLAGS_KEY = 'zaboon.testFlags'

export class ApiClientError extends Error {
  constructor(
    readonly code: ErrorCode | 'network',
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

export type ApiCallOptions<N extends RouteName> = {
  params?: Record<string, string>
  /** Query-string parameters (e.g. `courseId`, admin filters); undefined values are left out. */
  query?: Record<string, string | undefined>
  signal?: AbortSignal
} & (RouteRequest<N> extends undefined ? { body?: undefined } : { body: RouteRequest<N> })

export type ApiClient = <N extends RouteName>(
  name: N,
  ...opts: RouteRequest<N> extends undefined ? [ApiCallOptions<N>?] : [ApiCallOptions<N>]
) => Promise<RouteResponse<N>>

export interface ApiClientDeps {
  getAccessToken(): Promise<string | null>
  fetch?: typeof fetch
  baseUrl?: string
}

/** A local-mode test override from localStorage; always null outside local mode. */
function testValue(key: string): string | null {
  if (process.env.NEXT_PUBLIC_AUTH_MODE !== 'local') return null
  try {
    return globalThis.localStorage?.getItem(key) || null
  } catch {
    return null
  }
}

export function createApiClient(deps: ApiClientDeps): ApiClient {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const call = async (
    name: RouteName,
    opts: {
      params?: Record<string, string>
      query?: Record<string, string | undefined>
      body?: unknown
      signal?: AbortSignal
    } = {},
  ) => {
    const def = routes[name]
    const token = await deps.getAccessToken()
    const now = testValue(TEST_NOW_KEY)
    const flags = testValue(TEST_FLAGS_KEY)
    const search = new URLSearchParams()
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) search.set(k, v)
    const qs = search.toString()
    let res: Response
    try {
      res = await doFetch(`${deps.baseUrl ?? ''}${buildPath(def.path, opts.params)}${qs ? `?${qs}` : ''}`, {
        method: def.method,
        headers: {
          [APP_VERSION_HEADER]: APP_VERSION,
          ...(def.request ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(now ? { [TEST_NOW_HEADER]: now } : {}),
          ...(flags ? { [TEST_FLAGS_HEADER]: flags } : {}),
        },
        body: def.request && opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      })
    } catch (e) {
      throw new ApiClientError('network', 0, e instanceof Error ? e.message : 'network error')
    }
    const json: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      const env = ErrorEnvelope.safeParse(json)
      if (env.success)
        throw new ApiClientError(
          env.data.error.code,
          res.status,
          env.data.error.message,
          env.data.error.details,
        )
      throw new ApiClientError('internal', res.status, `unexpected ${res.status} from ${def.path}`)
    }
    return def.response.parse(json)
  }
  return call as ApiClient
}

/** TanStack Query keys for the read endpoints (invalidate these after writes). */
export const queryKeys = {
  meta: ['meta'],
  home: ['home'],
  path: ['path'],
  letters: ['letters'],
  words: ['words'],
  profile: ['profile'],
  settings: ['settings'],
  guidebook: (unitId: string) => ['guidebook', unitId] as const,
  // P2 (Wave 3): invalidate after a lesson completes (leaderboard, quests) and after purchases.
  leaderboard: ['leaderboard'],
  quests: ['quests'],
  shop: ['shop'],
  practice: ['practice'],
} as const

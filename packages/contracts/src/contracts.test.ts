import { describe, expect, it } from 'vitest'
import {
  AppConfig,
  Challenge,
  DEFAULT_APP_CONFIG,
  DEFAULT_SETTINGS,
  ERROR_STATUS,
  ErrorCode,
  MVP_CHALLENGE_TYPES,
  SessionKind,
  Settings,
  buildPath,
  routes,
} from './index'

describe('contracts', () => {
  it('default app config satisfies its schema and covers every session kind', () => {
    const cfg = AppConfig.parse(DEFAULT_APP_CONFIG)
    for (const kind of SessionKind.options) {
      expect(cfg.xp.base[kind]).toBeGreaterThan(0)
      expect(cfg.session.lengths[kind]).toBeGreaterThan(0)
    }
  })

  it('default settings are valid', () => {
    expect(Settings.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
  })

  it('the Challenge union has a member for every MVP challenge type', () => {
    const unionTypes = Challenge.options.map((o) => o.shape.type.value)
    for (const t of MVP_CHALLENGE_TYPES) expect(unionTypes).toContain(t)
  })

  it('every error code maps to an HTTP status', () => {
    for (const code of ErrorCode.options) expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400)
  })

  it('routes have unique method+path pairs and valid schemas', () => {
    const seen = new Set<string>()
    for (const [name, r] of Object.entries(routes)) {
      const key = `${r.method} ${r.path}`
      expect(seen.has(key), `${name} duplicates ${key}`).toBe(false)
      seen.add(key)
      expect(r.path.startsWith('/api/')).toBe(true)
      expect(r.response).toBeDefined()
      if (r.method === 'GET') expect(r.request, `${name}: GET routes take no body`).toBeUndefined()
      if (r.auth === 'dev') expect(r.path.startsWith('/api/dev/')).toBe(true)
      expect(Object.keys(DEFAULT_APP_CONFIG.rateLimits)).toContain(r.bucket)
    }
  })

  it('buildPath fills params and rejects missing ones', () => {
    expect(buildPath(routes.completeSession.path, { id: 'abc' })).toBe('/api/sessions/abc/complete')
    expect(() => buildPath(routes.completeSession.path)).toThrow()
  })
})

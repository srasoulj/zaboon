/**
 * apps/web/vercel.json (orchestrator-owned; the Vercel project's root directory is apps/web):
 * every scheduled path is a cron route of the contract, which Vercel calls with GET and
 * `Authorization: Bearer $CRON_SECRET` (withRoute's `cron` auth).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { routes } from '@zaboon/contracts'

interface VercelJson {
  crons?: { path: string; schedule: string }[]
}

const vercel = JSON.parse(
  readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'),
) as VercelJson
const crons = vercel.crons ?? []

describe('vercel.json crons', () => {
  it('schedules only GET cron routes from the contract', () => {
    expect(crons.length).toBeGreaterThan(0)
    for (const c of crons) {
      const route = Object.values(routes).find((r) => r.path === c.path)
      expect(route, `${c.path} is not a route`).toBeDefined()
      expect(route).toMatchObject({ method: 'GET', auth: 'cron' })
      expect(c.schedule.trim().split(/\s+/), `${c.path} schedule`).toHaveLength(5)
    }
    expect(new Set(crons.map((c) => c.path)).size).toBe(crons.length)
  })

  it('rolls leagues over weekly at UTC Monday 00:00', () => {
    expect(crons).toContainEqual({ path: routes.leagueRollover.path, schedule: '0 0 * * 1' })
  })
})

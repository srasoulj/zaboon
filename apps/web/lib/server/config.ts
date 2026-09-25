import type { AppConfig } from '@zaboon/contracts'
import { repos, type Db } from '@zaboon/db'

export interface RuntimeConfig {
  config: AppConfig
  flags: Record<string, boolean>
}

const TTL_MS = 30_000
let cache: { at: number; value: Promise<RuntimeConfig> } | undefined

/** AppConfig + flags with app_config overrides, cached for 30 s per server instance. */
export function getRuntimeConfig(db: Db): Promise<RuntimeConfig> {
  const now = Date.now()
  if (cache && now - cache.at < TTL_MS) return cache.value
  const value = repos.content.loadAppConfig(db).then(({ config, flags }) => ({ config, flags }))
  cache = { at: now, value }
  value.catch(() => {
    if (cache?.value === value) cache = undefined
  })
  return value
}

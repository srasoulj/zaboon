/**
 * Response caches. Build-time calls are cached by hash(model, prompt version, input) so reruns are
 * free and reproducible (LEARNING-ENGINE §4.2). The input is the whole request minus accounting
 * fields, so e.g. a TTS voice change is a different key.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ChatRequest, ChatResponse, ResponseCache } from './types'

/** Stable JSON: object keys sorted, so key order never changes a hash. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function cacheKey(model: string, promptVersion: string, req: ChatRequest): string {
  const { usage: _usage, provider: _provider, model: _model, ...input } = req
  return createHash('sha256').update(stableStringify({ model, promptVersion, input })).digest('hex')
}

export class MemoryResponseCache implements ResponseCache {
  readonly entries = new Map<string, ChatResponse>()
  async get(key: string): Promise<ChatResponse | null> {
    return this.entries.get(key) ?? null
  }
  async set(key: string, response: ChatResponse): Promise<void> {
    this.entries.set(key, response)
  }
}

/** One JSON file per key under `dir/<2 hex>/<key>.json`, written atomically. */
export class FileResponseCache implements ResponseCache {
  constructor(private readonly dir: string) {}

  private path(key: string): string {
    if (!/^[0-9a-f]{16,}$/.test(key)) throw new Error(`invalid cache key: ${key}`)
    return join(this.dir, key.slice(0, 2), `${key}.json`)
  }

  async get(key: string): Promise<ChatResponse | null> {
    try {
      return JSON.parse(readFileSync(this.path(key), 'utf8')) as ChatResponse
    } catch {
      return null
    }
  }

  async set(key: string, response: ChatResponse): Promise<void> {
    const target = this.path(key)
    mkdirSync(dirname(target), { recursive: true })
    const tmp = `${target}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(response))
    renameSync(tmp, target)
  }
}

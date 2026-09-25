/**
 * The real transport: `fetch` to OpenRouter's /chat/completions, with a per-attempt timeout and
 * retries with exponential backoff (plus jitter, honoring Retry-After) on 429, 5xx, network errors
 * and timeouts. Also the two plain GET endpoints the pipeline needs: /key and /models.
 */
import { AiHttpError, AiTimeoutError } from './errors'
import type { AiTransport, ChatRequest, ChatResponse, FetchLike } from './types'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const DEFAULT_REFERER = 'https://github.com/srasoulj/zaboon'
export const DEFAULT_TITLE = 'Zaboon'

export interface FetchTransportOptions {
  apiKey: string
  baseUrl?: string
  /** Sent as HTTP-Referer (OpenRouter app attribution). */
  referer?: string
  /** Sent as X-Title. */
  title?: string
  /** Per-attempt timeout. Default 120 s (image and audio generations are slow). */
  timeoutMs?: number
  /** Retries after the first attempt. Default 3. */
  maxRetries?: number
  /** First backoff delay; doubles per retry. Default 1 s. */
  backoffMs?: number
  fetch?: FetchLike
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500
}

/** Retry-After as seconds or an HTTP date → milliseconds (capped at 60 s). */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, 60_000)
  const at = Date.parse(header)
  return Number.isNaN(at) ? null : Math.min(Math.max(at - now, 0), 60_000)
}

interface RetryOptions {
  timeoutMs: number
  maxRetries: number
  backoffMs: number
  sleep: (ms: number) => Promise<void>
  random: () => number
}

/**
 * Runs `attempt` with a timeout per try, retrying retryable failures. `attempt` receives an
 * AbortSignal and returns the Response; non-retryable HTTP errors throw immediately.
 */
async function withRetries(
  fetchOnce: (signal: AbortSignal) => Promise<Response>,
  opts: RetryOptions,
  outer?: AbortSignal,
): Promise<Response> {
  let lastError: Error = new Error('no attempt made')
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    if (outer?.aborted) throw outer.reason instanceof Error ? outer.reason : new Error('aborted')
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, opts.timeoutMs)
    const onOuterAbort = () => controller.abort()
    outer?.addEventListener('abort', onOuterAbort, { once: true })
    let wait: number | null = null
    try {
      const res = await fetchOnce(controller.signal)
      if (res.ok) return res
      const body = await res.text().catch(() => '')
      lastError = new AiHttpError(res.status, body)
      if (!isRetryableStatus(res.status)) throw lastError
      wait = retryAfterMs(res.headers.get('retry-after'))
    } catch (e) {
      if (e instanceof AiHttpError && !isRetryableStatus(e.status)) throw e
      if (outer?.aborted) throw e
      if (timedOut)
        lastError = new AiTimeoutError(`OpenRouter request timed out after ${opts.timeoutMs} ms`)
      else if (!(e instanceof AiHttpError))
        lastError = e instanceof Error ? e : new Error(String(e))
    } finally {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onOuterAbort)
    }
    if (attempt < opts.maxRetries) {
      const backoff = opts.backoffMs * 2 ** attempt
      await opts.sleep(wait ?? backoff + Math.floor(opts.random() * backoff * 0.25))
    }
  }
  throw lastError
}

export class FetchTransport implements AiTransport {
  private readonly baseUrl: string
  private readonly retry: RetryOptions
  private readonly fetchImpl: FetchLike

  constructor(private readonly opts: FetchTransportOptions) {
    if (!opts.apiKey) throw new Error('FetchTransport needs an apiKey')
    this.baseUrl = (opts.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/, '')
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init))
    this.retry = {
      timeoutMs: opts.timeoutMs ?? 120_000,
      maxRetries: opts.maxRetries ?? 3,
      backoffMs: opts.backoffMs ?? 1_000,
      sleep: opts.sleep ?? defaultSleep,
      random: opts.random ?? Math.random,
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.opts.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': this.opts.referer ?? DEFAULT_REFERER,
      'X-Title': this.opts.title ?? DEFAULT_TITLE,
    }
  }

  async send(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const body = JSON.stringify(req)
    const res = await withRetries(
      (s) =>
        this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: this.headers(),
          body,
          signal: s,
        }),
      this.retry,
      signal,
    )
    const json = (await res.json()) as ChatResponse & {
      error?: { message?: string; code?: number }
    }
    // OpenRouter can answer 200 with an error object (e.g. a provider failure mid-stream).
    if (json.error) throw new AiHttpError(json.error.code ?? 502, JSON.stringify(json.error))
    return json
  }

  /** GET <baseUrl><path> with this transport's key, timeout and retries. */
  async getJson<T>(path: string): Promise<T> {
    const res = await withRetries(
      (s) => this.fetchImpl(`${this.baseUrl}${path}`, { headers: this.headers(), signal: s }),
      this.retry,
    )
    return (await res.json()) as T
  }
}

/** GET /key: the calling key's credit state (https://openrouter.ai/docs/api-reference/limits). */
export interface KeyInfo {
  label?: string
  /** Credit limit in USD; null = unlimited. */
  limit: number | null
  usage: number
  /** Remaining credit in USD; null = unlimited. */
  limit_remaining: number | null
  is_free_tier?: boolean
}

export async function fetchKeyInfo(opts: FetchTransportOptions): Promise<KeyInfo> {
  const res = await new FetchTransport(opts).getJson<{ data: KeyInfo }>('/key')
  return res.data
}

export interface OpenRouterModel {
  id: string
  name?: string
  created?: number
  pricing?: Record<string, string>
}

/** GET /models: the public model list (no key needed). */
export async function listModels(
  opts: Omit<FetchTransportOptions, 'apiKey'> = {},
): Promise<OpenRouterModel[]> {
  const baseUrl = (opts.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/, '')
  const fetchImpl: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init))
  const res = await withRetries((s) => fetchImpl(`${baseUrl}/models`, { signal: s }), {
    timeoutMs: opts.timeoutMs ?? 30_000,
    maxRetries: opts.maxRetries ?? 3,
    backoffMs: opts.backoffMs ?? 1_000,
    sleep: opts.sleep ?? defaultSleep,
    random: opts.random ?? Math.random,
  })
  const json = (await res.json()) as { data?: OpenRouterModel[] }
  return json.data ?? []
}

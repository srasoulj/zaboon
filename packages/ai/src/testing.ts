/**
 * Test helpers: replay recorded HTTP exchanges through the real FetchTransport.
 *
 * A recorded exchange pins what our transport must send (method, URL, the attribution headers,
 * the JSON body) and what OpenRouter answers. The `Authorization` header is checked for shape only
 * and never stored: recordings contain no credentials.
 */
import type { FetchLike } from './types'

export interface RecordedExchange {
  name: string
  request: {
    method: 'GET' | 'POST'
    url: string
    /** Header values to require (case-insensitive names). `Authorization` is never recorded. */
    headers?: Record<string, string>
    body?: unknown
  }
  response: {
    status: number
    headers?: Record<string, string>
    body: unknown
  }
}

export interface ReplayFetch extends FetchLike {
  /** Requests seen so far (URL, method, header names, parsed body). */
  readonly seen: { url: string; method: string; headers: Headers; body: unknown }[]
}

/**
 * A fetch that serves `exchanges` in order and throws on any mismatch, so a test fails when the
 * transport's wire format drifts from the recording.
 */
export function replayFetch(exchanges: readonly RecordedExchange[]): ReplayFetch {
  let i = 0
  const seen: ReplayFetch['seen'] = []
  const fn = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const ex = exchanges[i++]
    if (!ex) throw new Error(`replayFetch: unexpected request #${i} to ${input}`)
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
    seen.push({ url: input, method, headers, body })
    if (method !== ex.request.method || input !== ex.request.url)
      throw new Error(
        `replayFetch ${ex.name}: expected ${ex.request.method} ${ex.request.url}, got ${method} ${input}`,
      )
    for (const [k, v] of Object.entries(ex.request.headers ?? {})) {
      if (headers.get(k) !== v)
        throw new Error(`replayFetch ${ex.name}: header ${k} is ${headers.get(k)}, expected ${v}`)
    }
    if (ex.request.body !== undefined && JSON.stringify(body) !== JSON.stringify(ex.request.body))
      throw new Error(
        `replayFetch ${ex.name}: request body differs from the recording\n${JSON.stringify(body)}`,
      )
    return new Response(JSON.stringify(ex.response.body), {
      status: ex.response.status,
      headers: { 'content-type': 'application/json', ...ex.response.headers },
    })
  }
  return Object.assign(fn, { seen })
}

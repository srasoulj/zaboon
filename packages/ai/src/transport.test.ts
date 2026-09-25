import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  AiClient,
  AiHttpError,
  AiTimeoutError,
  FetchTransport,
  fetchKeyInfo,
  listModels,
  retryAfterMs,
} from './index'
import { replayFetch, type RecordedExchange } from './testing'

const recorded = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/openrouter.recorded.json'), 'utf8'),
) as RecordedExchange[]
const exchange = (name: string) => recorded.find((e) => e.name === name)!
// Not a credential: the replay never checks it against anything but its shape.
const KEY = 'test-key'
const SENTINEL = 'test-sentinel-value'
const noSleep = async () => {}

describe('FetchTransport against recorded OpenRouter exchanges', () => {
  it('sends a structured-output request exactly as recorded and parses the answer', async () => {
    const fetch = replayFetch([exchange('chat-json')])
    const client = new AiClient({ apiKey: KEY, fetch, appName: 'Zaboon content-cli' })
    const result = await client.json(z.object({ fa: z.string(), translit: z.string() }), {
      model: 'openai/gpt-6-astra',
      name: 'greeting',
      temperature: 0.4,
      messages: [
        { role: 'system', content: 'You write Persian course content.' },
        { role: 'user', content: 'Give one colloquial greeting.' },
      ],
    })
    expect(result.value).toEqual({ fa: 'سلام، خوبی؟', translit: 'salām, khubi?' })
    expect(result.costUsd).toBe(0.00156)
    expect(result.repaired).toBe(false)
    const sent = fetch.seen[0]!
    expect(sent.headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(sent.headers.get('http-referer')).toBe('https://github.com/srasoulj/zaboon')
  })

  it('retries a 429 after its Retry-After delay', async () => {
    const fetch = replayFetch([exchange('rate-limited'), exchange('after-rate-limit')])
    const waits: number[] = []
    const t = new FetchTransport({ apiKey: KEY, fetch, sleep: async (ms) => void waits.push(ms) })
    const res = await t.send({
      model: 'openai/gpt-6-luna',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(res.choices[0]!.message.content).toBe('ok')
    expect(waits).toEqual([2000])
    expect(fetch.seen).toHaveLength(2)
  })

  it('reads the key credit state from GET /key', async () => {
    const info = await fetchKeyInfo({ apiKey: KEY, fetch: replayFetch([exchange('key')]) })
    expect(info).toMatchObject({ limit: 10, usage: 2.5, limit_remaining: 7.5 })
  })
})

describe('FetchTransport retry policy', () => {
  const ok = () =>
    new Response(
      JSON.stringify({
        id: 'x',
        model: 'm',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      }),
    )
  const req = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }] }

  it('backs off exponentially on 5xx and network errors, then succeeds', async () => {
    const waits: number[] = []
    let n = 0
    const t = new FetchTransport({
      apiKey: KEY,
      backoffMs: 100,
      random: () => 0,
      sleep: async (ms) => void waits.push(ms),
      fetch: async () => {
        n++
        if (n === 1) return new Response('upstream', { status: 502 })
        if (n === 2) throw new TypeError('fetch failed')
        return ok()
      },
    })
    expect((await t.send(req)).choices[0]!.message.content).toBe('ok')
    expect(waits).toEqual([100, 200])
  })

  it('does not retry client errors', async () => {
    let n = 0
    const t = new FetchTransport({
      apiKey: KEY,
      sleep: noSleep,
      fetch: async () => {
        n++
        return new Response('{"error":{"message":"bad model"}}', { status: 400 })
      },
    })
    await expect(t.send(req)).rejects.toBeInstanceOf(AiHttpError)
    expect(n).toBe(1)
  })

  it('gives up after maxRetries with the last error', async () => {
    let n = 0
    const t = new FetchTransport({
      apiKey: KEY,
      maxRetries: 2,
      sleep: noSleep,
      fetch: async () => {
        n++
        return new Response('down', { status: 503 })
      },
    })
    await expect(t.send(req)).rejects.toThrow(/HTTP 503/)
    expect(n).toBe(3)
  })

  it('times out each attempt and reports a timeout', async () => {
    const t = new FetchTransport({
      apiKey: KEY,
      timeoutMs: 20,
      maxRetries: 1,
      sleep: noSleep,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    })
    await expect(t.send(req)).rejects.toBeInstanceOf(AiTimeoutError)
  })

  it('treats an error object in a 200 body as a failure', async () => {
    const t = new FetchTransport({
      apiKey: KEY,
      fetch: async () =>
        new Response(JSON.stringify({ error: { code: 502, message: 'provider error' } })),
    })
    await expect(t.send(req)).rejects.toThrow(/provider error/)
  })

  it('never leaks the key into error messages', async () => {
    const t = new FetchTransport({
      apiKey: SENTINEL,
      maxRetries: 0,
      fetch: async () => new Response('nope', { status: 401 }),
    })
    const err = (await t.send(req).catch((e: unknown) => e)) as Error
    expect(err.message).not.toContain(SENTINEL)
  })

  it('parses Retry-After seconds and dates, capped at 60 s', () => {
    expect(retryAfterMs('3')).toBe(3000)
    expect(retryAfterMs('999')).toBe(60_000)
    expect(retryAfterMs(new Date(10_000).toUTCString(), 5_000)).toBe(5_000)
    expect(retryAfterMs(null)).toBeNull()
    expect(retryAfterMs('soon')).toBeNull()
  })

  it('lists models without a key', async () => {
    const models = await listModels({
      fetch: async (url, init) => {
        expect(url).toBe('https://openrouter.ai/api/v1/models')
        expect(new Headers(init?.headers).has('authorization')).toBe(false)
        return new Response(JSON.stringify({ data: [{ id: 'openai/gpt-6-astra', created: 1 }] }))
      },
    })
    expect(models.map((m) => m.id)).toEqual(['openai/gpt-6-astra'])
  })

  it('requires a key', () => {
    expect(() => new FetchTransport({ apiKey: '' })).toThrow()
  })
})

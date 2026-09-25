import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  aiProvenance,
  approxTokens,
  BudgetExceededError,
  cacheKey,
  decodeDataUrl,
  estimateUsd,
  FileBudgetLedger,
  FileResponseCache,
  chatResponse,
  mediaProvenance,
  parsePromptId,
  priceOf,
  promptId,
  stableStringify,
} from './index'

const dirs: string[] = []
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'zaboon-ai-'))
  dirs.push(d)
  return d
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('response cache', () => {
  const req = {
    model: 'm',
    messages: [{ role: 'user' as const, content: 'x' }],
    audio: { voice: 'coral', format: 'mp3' as const },
  }

  it('keys on model, prompt version and input, not on key order or accounting fields', () => {
    const k = cacheKey('m', 'p@1', req)
    expect(
      cacheKey('m', 'p@1', {
        audio: req.audio,
        messages: req.messages,
        model: 'm',
        usage: { include: true },
      }),
    ).toBe(k)
    expect(cacheKey('m', 'p@2', req)).not.toBe(k)
    expect(cacheKey('m2', 'p@1', req)).not.toBe(k)
    expect(cacheKey('m', 'p@1', { ...req, audio: { voice: 'sage', format: 'mp3' } })).not.toBe(k)
    expect(stableStringify({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}')
  })

  it('round-trips responses through files', async () => {
    const cache = new FileResponseCache(temp())
    const key = cacheKey('m', 'p@1', req)
    expect(await cache.get(key)).toBeNull()
    await cache.set(key, chatResponse('hello'))
    expect((await cache.get(key))!.choices[0]!.message.content).toBe('hello')
    await expect(cache.get('../escape')).resolves.toBeNull()
  })
})

describe('FileBudgetLedger', () => {
  it('enforces a hard cap across reservations and records spend', async () => {
    const file = join(temp(), 'budget.json')
    const ledger = new FileBudgetLedger({ file, capUsd: 1 })
    await ledger.reserve(0.6, 'a')
    await expect(ledger.reserve(0.5, 'b')).rejects.toBeInstanceOf(BudgetExceededError)
    await ledger.record(0.25, 'a')
    await ledger.reserve(0.5, 'b')
    await ledger.record(0.5, 'b')
    expect(await ledger.spent()).toBe(0.75)
    const state = JSON.parse(readFileSync(file, 'utf8')) as {
      pending: unknown[]
      entries: { label: string }[]
    }
    expect(state.pending).toEqual([])
    expect(state.entries.map((e) => e.label)).toEqual(['a', 'b'])
    // A second process (another ledger on the same file) sees the same spend.
    await expect(
      new FileBudgetLedger({ file, capUsd: 1 }).reserve(0.3, 'c'),
    ).rejects.toBeInstanceOf(BudgetExceededError)
  })

  it('never lets concurrent reservations pass the cap', async () => {
    const file = join(temp(), 'budget.json')
    const ledgers = [0, 1, 2, 3].map(() => new FileBudgetLedger({ file, capUsd: 1 }))
    const results = await Promise.allSettled(
      ledgers.flatMap((l, i) => [l.reserve(0.3, `x${i}`), l.reserve(0.3, `y${i}`)]),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
  })

  it("checks the key's remaining OpenRouter credit before reserving", async () => {
    const file = join(temp(), 'budget.json')
    let remaining: number | null = 0.2
    const ledger = new FileBudgetLedger({ file, capUsd: 10, remainingUsd: async () => remaining })
    await expect(ledger.reserve(0.3, 'big')).rejects.toThrow(/remaining OpenRouter credit/)
    await ledger.reserve(0.1, 'small')
    remaining = null
    await ledger.reserve(5, 'unlimited key')
  })

  it('breaks a stale lock left by a crashed run', async () => {
    const file = join(temp(), 'budget.json')
    writeFileSync(`${file}.lock`, '99999')
    const old = new Date(Date.now() - 120_000)
    utimesSync(`${file}.lock`, old, old)
    const ledger = new FileBudgetLedger({ file, capUsd: 1, lockTimeoutMs: 2000 })
    await ledger.reserve(0.1, 'a')
    expect(ledger.read().pending).toHaveLength(1)
  })

  it('times out on a live lock', async () => {
    const file = join(temp(), 'budget.json')
    writeFileSync(`${file}.lock`, '1')
    const ledger = new FileBudgetLedger({ file, capUsd: 1, lockTimeoutMs: 50 })
    await expect(ledger.reserve(0.1, 'a')).rejects.toThrow(/timed out/)
  })
})

describe('pricing, provenance and media helpers', () => {
  it('estimates cost from the pinned price table; :batch is half price', () => {
    expect(estimateUsd('openai/gpt-6-astra', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(10)
    expect(
      estimateUsd('openai/gpt-6-astra:batch', { inputTokens: 0, outputTokens: 1_000_000 }),
    ).toBe(25)
    expect(priceOf('unknown/model').output).toBe(50)
    expect(approxTokens([{ role: 'user', content: 'abcdef' }])).toBe(2 + 8)
  })

  it('builds provenance with a versioned prompt id', () => {
    const now = new Date('2026-09-25T00:00:00Z')
    expect(promptId({ name: 'draft-unit', version: 3 })).toBe('draft-unit@3')
    expect(parsePromptId('art/character@2')).toEqual({ name: 'art/character', version: 2 })
    expect(() => parsePromptId('draft-unit')).toThrow()
    expect(aiProvenance('openai/gpt-6-astra', { name: 'draft-unit', version: 1 }, { now })).toEqual(
      {
        model: 'openai/gpt-6-astra',
        prompt: 'draft-unit@1',
        generatedAt: '2026-09-25T00:00:00.000Z',
      },
    )
    expect(
      mediaProvenance('img/x.png', 'openai/gpt-5.4-image-2', 'art-item@1', {
        references: ['a.png'],
        now,
      }),
    ).toMatchObject({
      asset: 'img/x.png',
      references: ['a.png'],
      status: 'draft',
    })
  })

  it('decodes base64 and plain data URLs', () => {
    expect(decodeDataUrl('data:image/png;base64,AAEC')).toMatchObject({ mime: 'image/png' })
    expect(decodeDataUrl('data:image/png;base64,AAEC').bytes).toEqual(Buffer.from([0, 1, 2]))
    expect(decodeDataUrl('data:,hi%20there').bytes.toString()).toBe('hi there')
    expect(() => decodeDataUrl('https://example.com/x.png')).toThrow()
  })
})

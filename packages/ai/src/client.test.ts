import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  AiClient,
  AiResponseError,
  BudgetExceededError,
  chatResponse,
  isStrictCompatible,
  MemoryBudgetLedger,
  MemoryResponseCache,
  MockTransport,
  MODELS,
  parseJsonContent,
  toDataUrl,
  toResponseFormat,
  type ChatRequest,
} from './index'

// Not a credential: MockTransport never sends it anywhere.
const TEST_KEY = 'test'
const Greeting = z.object({ fa: z.string(), translit: z.string() })
const messages = [{ role: 'user' as const, content: 'greet' }]
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(24, 1),
])
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(16),
])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(32, 2)])

function client(
  respond: (req: ChatRequest) => ReturnType<typeof chatResponse>,
  extra: Partial<ConstructorParameters<typeof AiClient>[0]> = {},
) {
  const transport = new MockTransport(respond)
  return { transport, ai: new AiClient({ apiKey: TEST_KEY, transport, ...extra }) }
}

describe('json()', () => {
  it('sends a json_schema response_format generated from zod and validates the answer', async () => {
    const { ai, transport } = client(() =>
      chatResponse('{"fa":"سلام","translit":"salām"}', { cost: 0.01 }),
    )
    const r = await ai.json(Greeting, { model: MODELS.content_text, name: 'greeting', messages })
    expect(r).toMatchObject({
      value: { fa: 'سلام', translit: 'salām' },
      costUsd: 0.01,
      repaired: false,
    })
    const format = transport.calls[0]!.response_format!
    expect(format.type).toBe('json_schema')
    expect(format.json_schema).toMatchObject({ name: 'greeting', strict: true })
    expect(format.json_schema.schema).toMatchObject({ required: ['fa', 'translit'] })
    expect(format.json_schema.schema).not.toHaveProperty('$schema')
  })

  it('turns strict mode off for schemas with optional properties', () => {
    expect(isStrictCompatible(toResponseFormat(Greeting, 'g').json_schema.schema)).toBe(true)
    const loose = toResponseFormat(z.object({ a: z.string(), b: z.string().optional() }), 'l')
    expect(loose.json_schema.strict).toBe(false)
    expect(toResponseFormat(z.object({ a: z.string().nullable() }), 'n').json_schema.strict).toBe(
      true,
    )
  })

  it('repairs an invalid answer once, telling the model what was wrong', async () => {
    const answers = ['{"fa":"سلام"}', '{"fa":"سلام","translit":"salām"}']
    const { ai, transport } = client(() => chatResponse(answers.shift()!))
    const r = await ai.json(Greeting, { model: MODELS.content_text, name: 'greeting', messages })
    expect(r.repaired).toBe(true)
    expect(r.value.translit).toBe('salām')
    const repair = transport.calls[1]!.messages
    expect(repair.at(-2)).toEqual({ role: 'assistant', content: '{"fa":"سلام"}' })
    expect(repair.at(-1)!.content).toContain('translit')
  })

  it('fails after one unsuccessful repair', async () => {
    const { ai, transport } = client(() => chatResponse('not json'))
    await expect(
      ai.json(Greeting, { model: MODELS.content_text, name: 'g', messages }),
    ).rejects.toBeInstanceOf(AiResponseError)
    expect(transport.calls).toHaveLength(2)
  })

  it('accepts a fenced JSON answer', () => {
    expect(parseJsonContent('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(() => parseJsonContent(null)).toThrow(AiResponseError)
  })
})

describe('cache and budget', () => {
  it('serves repeated prompt-versioned calls from the cache for free', async () => {
    const cache = new MemoryResponseCache()
    const budget = new MemoryBudgetLedger(1)
    const { ai, transport } = client(
      () => chatResponse('{"fa":"سلام","translit":"salām"}', { cost: 0.02 }),
      { cache, budget },
    )
    const opts = { model: MODELS.content_text, name: 'g', messages, promptVersion: 'greet@1' }
    const a = await ai.json(Greeting, opts)
    const b = await ai.json(Greeting, opts)
    expect([a.cached, b.cached]).toEqual([false, true])
    expect(b.costUsd).toBe(0)
    expect(transport.calls).toHaveLength(1)
    expect(await budget.spent()).toBe(0.02)
    await ai.json(Greeting, { ...opts, promptVersion: 'greet@2' })
    expect(transport.calls).toHaveLength(2)
  })

  it('never caches an invalid answer', async () => {
    const cache = new MemoryResponseCache()
    const { ai } = client(() => chatResponse('{}'), { cache })
    await expect(
      ai.json(Greeting, { model: 'm', name: 'g', messages, promptVersion: 'g@1' }),
    ).rejects.toThrow()
    expect(cache.entries.size).toBe(0)
  })

  it('refuses a call whose estimate would pass the cap, before sending it', async () => {
    const budget = new MemoryBudgetLedger(0.001)
    const { ai, transport } = client(() => chatResponse('x'), { budget })
    await expect(
      ai.chat({ model: MODELS.content_text, messages, max_tokens: 1000 }),
    ).rejects.toBeInstanceOf(BudgetExceededError)
    expect(transport.calls).toHaveLength(0)
  })

  it('records the reported cost, or the estimate when none is reported', async () => {
    const budget = new MemoryBudgetLedger(5)
    const { ai } = client(() => chatResponse('x'), { budget })
    await ai.chat({ model: MODELS.app_explain, messages }, { estimateUsd: 0.5, label: 'est' })
    expect(await budget.spent()).toBe(0.5)
  })

  it('releases the reservation when the request fails', async () => {
    const budget = new MemoryBudgetLedger(1)
    const { ai } = client(
      () => {
        throw new Error('network down')
      },
      { budget },
    )
    await expect(ai.chat({ model: 'm', messages }, { estimateUsd: 0.9 })).rejects.toThrow(
      'network down',
    )
    // The 0.9 reservation is gone: another 0.9 fits under the cap.
    await expect(budget.reserve(0.9, 'next')).resolves.toBeUndefined()
    expect(await budget.spent()).toBe(0)
  })

  it('applies usage accounting and the data-collection policy', async () => {
    const { ai, transport } = client(() => chatResponse('ok'), { dataCollection: 'deny' })
    await ai.chat({ model: MODELS.app_explain, messages })
    expect(transport.calls[0]).toMatchObject({
      usage: { include: true },
      provider: { data_collection: 'deny' },
    })
  })
})

describe('image()', () => {
  it('sends the prompt plus reference images and returns PNG or WebP bytes', async () => {
    const outputs = [PNG, WEBP]
    const { ai, transport } = client(() =>
      chatResponse('here you go', { images: [toDataUrl('image/png', outputs.shift()!)] }),
    )
    const r = await ai.image('a hoopoe', [
      { mime: 'image/png', bytes: PNG },
      'data:image/webp;base64,AAAA',
    ])
    expect(r.mime).toBe('image/png')
    expect(r.bytes.equals(PNG)).toBe(true)
    expect(r.text).toBe('here you go')
    const req = transport.calls[0]!
    expect(req.model).toBe(MODELS.content_image)
    expect(req.modalities).toEqual(['image', 'text'])
    const parts = req.messages[0]!.content as { type: string }[]
    expect(parts.map((p) => p.type)).toEqual(['text', 'image_url', 'image_url'])
    // The declared MIME is not trusted: WebP bytes labelled PNG come back as WebP.
    expect((await ai.image('again')).mime).toBe('image/webp')
  })

  it('rejects responses without an image or with other formats', async () => {
    await expect(client(() => chatResponse('sorry')).ai.image('x')).rejects.toThrow(/no image/)
    const jpeg = client(() => chatResponse(null, { images: [toDataUrl('image/jpeg', JPEG)] }))
    await expect(jpeg.ai.image('x')).rejects.toThrow(/PNG or WebP/)
  })
})

describe('speech() and transcribe()', () => {
  it('requests mp3 audio output with the voice and returns the bytes', async () => {
    const { ai, transport } = client(() =>
      chatResponse(null, { audio: { data: MP3.toString('base64'), transcript: 'سلام' } }),
    )
    const r = await ai.speech('سَلام', 'coral')
    expect(r.bytes.equals(MP3)).toBe(true)
    expect(r.transcript).toBe('سلام')
    const req = transport.calls[0]!
    expect(req).toMatchObject({
      model: MODELS.content_audio,
      modalities: ['text', 'audio'],
      audio: { voice: 'coral', format: 'mp3' },
    })
    expect(req.messages.at(-1)).toEqual({ role: 'user', content: 'سَلام' })
  })

  it('rejects non-mp3 audio', async () => {
    const { ai } = client(() =>
      chatResponse(null, { audio: { data: Buffer.from('RIFFxxxxWAVE').toString('base64') } }),
    )
    await expect(ai.speech('x', 'coral')).rejects.toThrow(/not an MP3/)
  })

  it('transcribes audio input', async () => {
    const { ai, transport } = client(() => chatResponse(' سلام، خوبی؟ '))
    const r = await ai.transcribe({ bytes: MP3, format: 'mp3' })
    expect(r.text).toBe('سلام، خوبی؟')
    const parts = transport.calls[0]!.messages[0]!.content as {
      type: string
      input_audio?: { format: string }
    }[]
    expect(parts[1]).toMatchObject({ type: 'input_audio', input_audio: { format: 'mp3' } })
    expect(transport.calls[0]!.model).toBe(MODELS.app_transcribe)
  })
})

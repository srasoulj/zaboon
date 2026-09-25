import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { AiClient, MODELS, MockTransport } from './index'

describe('@zaboon/ai contract', () => {
  it('MODELS mirrors ai.models.yaml and pins exact versions', () => {
    const yaml = parse(readFileSync(join(__dirname, '..', 'ai.models.yaml'), 'utf8')) as Record<string, string>
    expect(yaml).toEqual(MODELS)
    for (const id of Object.values(MODELS)) expect(id.startsWith('~')).toBe(false)
  })
  it('requires a key or a transport', () => {
    expect(() => new AiClient({ apiKey: '' })).toThrow()
  })
  it('sends through the transport with usage accounting and data-collection policy', async () => {
    const t = new MockTransport((req) => ({
      id: 'x', model: req.model, choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    }))
    const c = new AiClient({ apiKey: 'test', transport: t, dataCollection: 'deny' })
    const r = await c.chat({ model: MODELS.app_explain, messages: [{ role: 'user', content: 'hi' }] })
    expect(r.choices[0]!.message.content).toBe('ok')
    expect(t.calls[0]!.usage).toEqual({ include: true })
    expect(t.calls[0]!.provider).toEqual({ data_collection: 'deny' })
  })
})

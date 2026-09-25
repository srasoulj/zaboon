import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { OpenRouterModel } from '@zaboon/ai'
import { checkModels, family, findNewer, formatFindings, versionOf } from './models'

const recorded = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/openrouter-models.recorded.json'), 'utf8'),
) as {
  data: OpenRouterModel[]
}
const serve = (models: OpenRouterModel[]) => async (url: string) => {
  expect(url).toBe('https://openrouter.ai/api/v1/models')
  return new Response(JSON.stringify({ data: models }))
}

describe('models check', () => {
  it('finds every pinned model in the recorded list, with nothing newer in its family', async () => {
    const findings = await checkModels({ fetch: serve(recorded.data) })
    expect(findings.map((f) => [f.role, f.available, f.newer])).toEqual([
      ['content_text', true, []],
      ['content_text_batch', true, []],
      ['content_image', true, []],
      ['content_audio', true, []],
      ['app_transcribe', true, []],
      ['app_explain', true, []],
      ['app_roleplay', true, []],
    ])
    expect(formatFindings(findings)[2]).toBe(
      '✔ content_image: openai/gpt-5.4-image-2 is the newest in its family',
    )
  })

  it('flags newer versions in a pinned family and pinned models that disappeared', async () => {
    const created = recorded.data.find((m) => m.id === 'openai/gpt-6-astra')!.created!
    const models = [
      ...recorded.data.filter((m) => m.id !== 'openai/gpt-6-sol'),
      { id: 'openai/gpt-5.6-image-3', created: created + 10 },
      { id: 'openai/gpt-6.1-astra', created: created + 10 },
      { id: 'openai/gpt-6.1-astra:batch', created: created + 10 },
      { id: 'openai/gpt-audio-2026-10-01', created: created + 10 },
    ]
    const findings = await checkModels({ fetch: serve(models) })
    const by = Object.fromEntries(findings.map((f) => [f.role, f]))
    expect(by.content_image!.newer).toEqual(['openai/gpt-5.6-image-3'])
    expect(by.content_text!.newer).toEqual(['openai/gpt-6.1-astra'])
    expect(by.content_text_batch!.newer).toEqual(['openai/gpt-6.1-astra'])
    expect(by.content_audio!.newer).toEqual(['openai/gpt-audio-2026-10-01'])
    expect(by.app_transcribe!.newer).toEqual([])
    expect(by.app_roleplay!.available).toBe(false)
    expect(formatFindings(findings)).toContainEqual(
      '✘ app_roleplay: openai/gpt-6-sol is no longer listed on OpenRouter',
    )
    expect(formatFindings(findings)).toContainEqual(
      '! content_image: openai/gpt-5.4-image-2 is pinned; newer in this family: openai/gpt-5.6-image-3',
    )
  })

  it('compares versions numerically and falls back to the created date', () => {
    expect(family('openai/gpt-5.4-image-2')).toBe('openai/gpt-#-image-#')
    expect(versionOf('openai/gpt-5.10-image-2')).toEqual([5, 10, 2])
    const models = [
      { id: 'x/m-1.9', created: 5 },
      { id: 'x/m-1.10', created: 1 },
      { id: 'x/m-1.2', created: 9 },
    ]
    expect(findNewer('x/m-1.9', models)).toEqual(['x/m-1.10'])
    expect(
      findNewer('x/m-v', [
        { id: 'x/m-v', created: 1 },
        { id: 'x/m-v', created: 1 },
      ]),
    ).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import {
  AnswerGraph,
  Lexeme,
  LessonSpec,
  Sentence,
  itemRef,
  parseItemRef,
  patternList,
  Provenance,
} from './index'

const prov = { author: 'test' }

describe('content-schema', () => {
  it('parses a lexeme and rejects bad ids', () => {
    const lx = {
      id: 'lx_ab',
      fa: 'آب',
      translit: 'āb',
      pos: 'noun',
      glosses: ['water'],
      introducedIn: 'u04-food',
      status: 'draft',
      provenance: prov,
    }
    expect(Lexeme.parse(lx).id).toBe('lx_ab')
    expect(() => Lexeme.parse({ ...lx, id: 'water' })).toThrow()
  })

  it('parses a sentence with tokens and pattern lists', () => {
    const s = Sentence.parse({
      id: 's_u04_0007',
      fa: 'من آب می‌خوام',
      faFormal: 'من آب می‌خواهم',
      translit: 'man āb mikhām',
      tokens: [
        { surface: 'من', lexeme: 'lx_man', translit: 'man', gloss: 'I' },
        { surface: 'آب', lexeme: 'lx_ab', translit: 'āb', gloss: 'water' },
        { surface: 'می‌خوام', lexeme: 'lx_khastan', translit: 'mikhām', gloss: '(I) want' },
      ],
      en: ["[I want/I'd like] [some/] water", 'water, please'],
      unit: 'u04-food',
      status: 'approved',
      provenance: { model: 'openai/gpt-6-astra', prompt: 'draft-sentences@1' },
    })
    expect(patternList(s.en)).toHaveLength(2)
    expect(patternList(undefined)).toEqual([])
  })

  it('provenance requires an author or a model', () => {
    expect(() => Provenance.parse({})).toThrow()
  })

  it('lesson spec defaults', () => {
    const spec = LessonSpec.parse({ focus: {} })
    expect(spec.mix).toBe('standard')
    expect(spec.pinned).toEqual([])
    expect(spec.pinnedOnly).toBe(false)
  })

  it('answer graph shape', () => {
    expect(
      AnswerGraph.parse({
        v: 1,
        start: 0,
        accept: [2],
        edges: [
          { from: 0, to: 1, t: 'hi' },
          { from: 1, to: 2, t: '' },
        ],
      }),
    ).toBeTruthy()
  })

  it('item refs round-trip', () => {
    expect(parseItemRef(itemRef('lexeme', 'lx_ab'))).toEqual({ kind: 'lexeme', id: 'lx_ab' })
    expect(() => parseItemRef('nope')).toThrow()
  })
})

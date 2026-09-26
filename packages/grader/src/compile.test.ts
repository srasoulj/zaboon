import { describe, expect, it } from 'vitest'
import { AnswerGraph } from '@zaboon/content-schema'
import { accepts, canonical, compile, enumerate, MAX_EDGES } from './index'

const Z = '‌'

describe('compile', () => {
  it('keeps the authored first pattern as the canonical answer', () => {
    const g = compile([`من آب می${Z}خوام`], {
      lang: 'fa',
      formal: `من آب می${Z}خواهم`,
      variants: [[`می${Z}خوام`, `می${Z}خام`]],
    })
    expect(canonical(g)).toBe(`من آب می${Z}خوام`)
    expect(() => AnswerGraph.parse(g)).not.toThrow()
  })

  it('merges a same-length formal sentence slot by slot and records registers per node', () => {
    const g = compile([`من کتابا رو می${Z}خوام`], {
      lang: 'fa',
      formal: `من کتاب${Z}ها را می${Z}خواهم`,
      pronounDrop: false,
    })
    const all = enumerate(g)
    expect(all).toHaveLength(8) // 2 × 2 × 2 register choices in the three differing slots
    expect(all).toContain(`من کتاب${Z}ها رو می${Z}خوام`)
    const regs = Object.values(g.registers ?? {})
    expect(regs.filter((r) => r === 'formal')).toHaveLength(3)
    expect(regs.filter((r) => r === 'colloquial')).toHaveLength(3)
  })

  it('adds a formal sentence of another length as its own pattern (no mixing)', () => {
    const g = compile([`مامانم خونه${Z}ست`], {
      lang: 'fa',
      formal: 'مادرم خانه است',
      pronounDrop: false,
    })
    expect(enumerate(g).sort()).toEqual(['مادرم خانه است', `مامانم خونه${Z}ست`].sort())
    expect(Object.values(g.registers ?? {})).toContain('formal')
  })

  it('omits registers when there is no formal sentence or it equals the pattern', () => {
    expect(compile(['سلام'], { lang: 'fa' }).registers).toBeUndefined()
    expect(compile(['سلام'], { lang: 'fa', formal: 'سلام' }).registers).toBeUndefined()
  })

  it('makes a sentence-initial pronoun optional, in every pattern', () => {
    const g = compile(['من خسته هستم', 'ما خسته هستیم'], { lang: 'fa' })
    expect(enumerate(g)).toEqual(expect.arrayContaining(['خسته هستم', 'خسته هستیم']))
    expect(enumerate(compile(['آب من'], { lang: 'fa' }))).toEqual(['آب من'])
    expect(enumerate(compile(['من'], { lang: 'fa' }))).toEqual(['من'])
    expect(enumerate(compile(['I want water'], { lang: 'en' }))).toEqual(['I want water'])
  })

  it('treats a pronoun group slot as droppable', () => {
    const g = compile(['[من/ما] آب می‌خوایم'], { lang: 'fa' })
    expect(accepts(g, 'آب می‌خوایم', 'fa')).toBe(true)
  })

  it('merges multi-token orthography variants in both directions', () => {
    const variants = [
      ['اینو', 'این رو'],
      ['دوست دارم', 'دوس دارم'],
    ]
    const g = compile(['اینو دوست دارم'], { lang: 'fa', variants })
    for (const a of ['اینو دوست دارم', 'این رو دوست دارم', 'اینو دوس دارم', 'این رو دوس دارم'])
      expect(accepts(g, a, 'fa'), a).toBe(true)
    const back = compile(['این رو دوس دارم'], { lang: 'fa', variants })
    expect(accepts(back, 'اینو دوست دارم', 'fa')).toBe(true)
  })

  it('matches variants by key, so ZWNJ and spacing differences still match', () => {
    const g = compile(['کتاب ها کجان'], { lang: 'fa', variants: [['کتابا', `کتاب${Z}ها`]] })
    expect(accepts(g, 'کتابا کجان', 'fa')).toBe(true)
  })

  it('joins a standalone affix word to its neighbor so tiles and keys agree', () => {
    const g = compile(['من کتاب ها رو می خوام'], { lang: 'fa', pronounDrop: false })
    expect(canonical(g)).toBe('من کتاب ها رو می خوام')
    expect(g.edges.map((e) => e.t)).toEqual(['من', 'کتاب ها', 'رو', 'می خوام'])
    expect(accepts(g, 'من کتابها رو میخوام', 'fa')).toBe(true)
    expect(accepts(g, 'من کتاب ها رو می خوام'.split(' '), 'fa')).toBe(true)
  })

  it('rejects malformed patterns and oversized graphs', () => {
    expect(() => compile(['[a/[b]]'], { lang: 'en' })).toThrow(/nested/)
    expect(() => compile(['a ] b'], { lang: 'en' })).toThrow()
    const huge = Array.from({ length: 16 }, (_, i) => `[w${i}a/w${i}b/w${i}c/w${i}d]`).join(' ')
    expect(() =>
      compile(
        Array.from({ length: 400 }, () => huge),
        { lang: 'en' },
      ),
    ).toThrow(String(MAX_EDGES))
  })

  it('supports escaped syntax characters', () => {
    const g = compile(['a \\[b\\/c\\] d'], { lang: 'en' })
    expect(canonical(g)).toBe('a [b/c] d')
  })
})

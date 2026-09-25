import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ALPHABET, NON_CONNECTORS, ZWJ } from '@zaboon/farsi'
import { PERSIAN_ALPHABET, letterByChar, letterBySlug, neighbors } from './alphabet'

interface CourseLetter {
  id: string
  letter: string
  name: string
  translit: string
  ipa: string
  connects: boolean
  order: number
}

/**
 * Reads the flat `letters:` list of content/fa-en/letters.yaml (one `key: value` per line). The
 * web app has no YAML dependency, and this file's shape is fixed by the content schema.
 */
function courseLetters(): CourseLetter[] {
  const path = fileURLToPath(new URL('../../../../content/fa-en/letters.yaml', import.meta.url))
  const out: Record<string, string>[] = []
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.replace(/\s+#.*$/, '')
    const start = /^ {2}- id: (\S+)/.exec(line)
    if (start) {
      out.push({ id: start[1]! })
      continue
    }
    const field = /^ {4}(letter|name|translit|ipa|connects|order): (.+)$/.exec(line)
    if (field && out.length > 0) out[out.length - 1]![field[1]!] = field[2]!.trim()
  }
  // `lessons:` entries share the `- id:` shape but have no letter.
  return out.filter((r) => r.letter !== undefined).map((r) => ({
    id: r.id!,
    letter: r.letter!,
    name: r.name!,
    translit: r.translit!,
    ipa: r.ipa!,
    connects: r.connects === 'true',
    order: Number(r.order),
  }))
}

describe('the alphabet table', () => {
  it('has the 32 letters of @zaboon/farsi in dictionary order with unique slugs', () => {
    expect(PERSIAN_ALPHABET).toHaveLength(32)
    expect(PERSIAN_ALPHABET.map((l) => l.letter)).toEqual([...ALPHABET])
    expect(PERSIAN_ALPHABET.map((l) => l.order)).toEqual(ALPHABET.map((_, i) => i + 1))
    const slugs = PERSIAN_ALPHABET.map((l) => l.slug)
    expect(new Set(slugs).size).toBe(32)
    for (const s of slugs) expect(s).toMatch(/^[a-z]+(-[a-z]+)*$/)
  })

  it('derives joining and the four forms from @zaboon/farsi', () => {
    const nonJoiners = PERSIAN_ALPHABET.filter((l) => !l.connects).map((l) => l.letter)
    expect(nonJoiners).toEqual(['ا', 'د', 'ذ', 'ر', 'ز', 'ژ', 'و'])
    for (const l of PERSIAN_ALPHABET) {
      expect(l.connects).toBe(!NON_CONNECTORS.has(l.letter))
      expect(l.forms.isolated).toBe(l.letter)
      expect(l.forms.final).toBe(ZWJ + l.letter)
      expect(l.forms.initial).toBe(l.connects ? l.letter + ZWJ : l.letter)
      expect(l.forms.medial).toBe(l.connects ? ZWJ + l.letter + ZWJ : ZWJ + l.letter)
    }
  })

  it('matches content/fa-en/letters.yaml wherever the two overlap', () => {
    const course = courseLetters()
    expect(course.length).toBeGreaterThan(5)
    for (const c of course) {
      const l = letterByChar(c.letter)
      expect(l, c.letter).toBeDefined()
      expect({
        name: l!.name,
        translit: l!.translit,
        ipa: l!.ipa,
        connects: l!.connects,
        order: l!.order,
      }).toEqual({
        name: c.name,
        translit: c.translit,
        ipa: c.ipa,
        connects: c.connects,
        order: c.order,
      })
    }
  })

  it('every example word contains its letter and is a single whole word', () => {
    for (const l of PERSIAN_ALPHABET) {
      expect(l.example.fa, l.slug).toContain(l.letter)
      expect(l.example.fa).not.toMatch(/\s/)
      expect(l.example.en.length).toBeGreaterThan(0)
    }
  })

  it('lists same-sound letters symmetrically', () => {
    for (const l of PERSIAN_ALPHABET)
      for (const other of l.sameSoundAs) expect(letterByChar(other)!.sameSoundAs).toContain(l.letter)
    expect(letterBySlug('sin')!.sameSoundAs).toEqual(['ص', 'ث'])
    expect(letterBySlug('be')!.sameSoundAs).toEqual([])
  })

  it('looks letters up by slug and wraps neighbors', () => {
    expect(letterBySlug('be')?.letter).toBe('ب')
    expect(letterBySlug('nope')).toBeUndefined()
    expect(neighbors('alef')).toMatchObject({ prev: { slug: 'ye' }, next: { slug: 'be' } })
    expect(neighbors('ye')).toMatchObject({ prev: { slug: 'he' }, next: { slug: 'alef' } })
    expect(neighbors('nope')).toBeNull()
  })
})

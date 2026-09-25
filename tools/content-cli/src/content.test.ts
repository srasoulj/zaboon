import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { CharactersBundle, LettersBundle, Manifest, UnitBundle } from '@zaboon/content-schema'
import { accepts } from '@zaboon/grader'
import { BuildError, buildCourse, readBuildInfo, writeBundle } from './build'
import { loadCourse, type LoadedCourse } from './load'
import { repoRoot } from './paths'
import { hasErrors, validateCourse } from './validate'

const FIXTURES = join(repoRoot(), 'content/fixtures')
const fixtures = loadCourse(FIXTURES)
const clone = (): LoadedCourse => structuredClone(fixtures)
const errors = (c: LoadedCourse, allowDrafts = false) =>
  validateCourse(c, { allowDrafts })
    .filter((i) => i.severity === 'error')
    .map((i) => i.message)

const tmp: string[] = []
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'zaboon-content-'))
  tmp.push(d)
  return d
}
afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true })
})

describe('fixture course', () => {
  it('loads and validates strictly with no issues', () => {
    expect(validateCourse(fixtures, { allowDrafts: false })).toEqual([])
    expect(fixtures.units.map((u) => u.id)).toEqual(['u01-fixture'])
    expect(fixtures.units[0]!.levels.map((l) => l.id)).toEqual([
      'u01-s0',
      'u01-l1',
      'u01-l2',
      'u01-p1',
      'u01-r1',
    ])
  })
})

describe('build', () => {
  const bundle = buildCourse(fixtures, {
    version: 3,
    allowDrafts: false,
    now: new Date('2026-09-25T00:00:00Z'),
  })
  const json = (path: string): unknown => JSON.parse(bundle.files.get(path)!.toString('utf8'))
  const unit = UnitBundle.parse(json('v3/units/u01-fixture.json'))

  it('emits schema-valid manifest, unit, letters and characters bundles', () => {
    const manifest = Manifest.parse(json('v3/manifest.json'))
    expect(manifest).toMatchObject({
      courseId: 'fixture',
      version: 3,
      includesDrafts: false,
      assetsBase: '../assets/',
    })
    expect(manifest.units).toEqual({ 'u01-fixture': 'units/u01-fixture.json' })
    expect(manifest.sections[0]!.units[0]!.levels[0]).toEqual({
      id: 'u01-s0',
      kind: 'lesson',
      title: 'First steps',
      lessons: 1,
    })
    expect(manifest.sections[0]!.units[0]!.hasGuidebook).toBe(true)
    expect(LettersBundle.parse(json('v3/letters.json')).track.letters).toHaveLength(10)
    expect(CharactersBundle.parse(json('v3/characters.json')).characters.map((c) => c.id)).toEqual([
      'leila',
      'hodhod',
    ])
    expect(unit.guidebook).toContain('#')
  })

  it('includes every item the unit references, with compiled answer graphs', () => {
    expect(unit.lexemes.map((l) => l.id).sort()).toEqual(fixtures.lexemes.map((l) => l.id).sort())
    expect(unit.sentences.map((s) => s.id).sort()).toEqual(
      fixtures.sentences.map((s) => s.id).sort(),
    )
    expect(unit.chats.map((c) => c.id)).toEqual(['c_u01_001'])
    const s = (id: string) => unit.sentences.find((x) => x.id === id)!
    expect(accepts(s('s_u01_0002').graphs.en, "I'd like water", 'en')).toBe(true)
    expect(accepts(s('s_u01_0002').graphs.en, 'I want some water', 'en')).toBe(true)
    expect(accepts(s('s_u01_0002').graphs.en, 'I want bread', 'en')).toBe(false)
    expect(accepts(s('s_u01_0003').graphs.fa, 'نون می‌خوام', 'fa')).toBe(true)
    expect(accepts(s('s_u01_0003').graphs.fa, 'من نون می‌خوام', 'fa')).toBe(true)
    expect(accepts(s('s_u01_0001').graphs.fa, 'سلام، خوب هستی؟', 'fa')).toBe(true)
  })

  it('rewrites every media ref to a content-hashed asset that is in the bundle', () => {
    const refs: string[] = []
    for (const l of unit.lexemes)
      refs.push(...[l.audio, l.image].filter((r): r is string => Boolean(r)))
    for (const s of unit.sentences)
      refs.push(
        ...Object.values(s.audio ?? {}).filter(
          (r): r is string => typeof r === 'string' && r.includes('/'),
        ),
      )
    expect(refs.length).toBeGreaterThan(30)
    for (const ref of refs) {
      expect(ref).toMatch(/\.[0-9a-f]{10}\.(mp3|svg|json)$/)
      expect(bundle.files.has(`assets/${ref}`)).toBe(true)
    }
  })

  it('has a content hash that ignores version and time but tracks content', () => {
    const again = buildCourse(fixtures, {
      version: 9,
      allowDrafts: false,
      now: new Date('2030-01-01T00:00:00Z'),
    })
    expect(again.contentHash).toBe(bundle.contentHash)
    const changed = clone()
    changed.sentences[0]!.en = 'Hello'
    expect(buildCourse(changed, { version: 3, allowDrafts: false }).contentHash).not.toBe(
      bundle.contentHash,
    )
  })

  it('refuses to build content with errors', () => {
    const broken = clone()
    broken.chats[0]!.answer = 7
    expect(() => buildCourse(broken, { version: 1, allowDrafts: false })).toThrow(BuildError)
  })

  it('writes immutable versions and shared hashed assets', () => {
    const out = tempDir()
    const root = writeBundle(bundle, out)
    expect(readdirSync(root).sort()).toEqual(['assets', 'v3'])
    expect(readBuildInfo(join(root, 'v3'))).toEqual({
      contentHash: bundle.contentHash,
      includesDrafts: false,
    })
    expect(() => writeBundle(bundle, out)).toThrow(/immutable/)
    expect(() => writeBundle(bundle, out, { overwrite: true })).not.toThrow()
  })
})

describe('validate', () => {
  it('rejects unknown items, wrong kinds and missing directions in pinned specs', () => {
    const c = clone()
    const pinned = c.units[0]!.levels[0]!.spec!.pinned
    pinned[0]!.items = ['s_nope']
    pinned[1] = { type: 'translate_bank', items: ['lx_ab'] }
    const errs = errors(c)
    expect(errs).toContainEqual(expect.stringContaining('unknown item s_nope'))
    expect(errs).toContainEqual(expect.stringContaining('lx_ab is not a sentence'))
    expect(errs).toContainEqual(expect.stringContaining('needs a direction'))
  })

  it('rejects drafts unless drafts are allowed', () => {
    const c = clone()
    c.lexemes[0]!.status = 'draft'
    expect(errors(c)).toContainEqual(
      expect.stringContaining(`lexeme ${c.lexemes[0]!.id} is a draft`),
    )
    expect(errors(c, true)).toEqual([])
    expect(buildCourse(c, { version: 1, allowDrafts: true }).includesDrafts).toBe(true)
  })

  it('treats missing media as an error, or a warning for drafts in dev builds', () => {
    const c = clone()
    c.assets.delete('audio/lx_salam.mp3')
    expect(errors(c)).toContainEqual('lexeme lx_salam: media not found: assets/audio/lx_salam.mp3')
    c.lexemes.find((l) => l.id === 'lx_salam')!.status = 'draft'
    expect(errors(c, true)).toEqual([])
    const built = buildCourse(c, { version: 1, allowDrafts: true })
    expect(built.warnings.map((w) => w.message)).toContainEqual(expect.stringContaining('lx_salam'))
    const unit = UnitBundle.parse(
      JSON.parse(built.files.get('v1/units/u01-fixture.json')!.toString('utf8')),
    )
    expect(unit.lexemes.find((l) => l.id === 'lx_salam')!.audio).toBeUndefined()
  })

  it('checks chats, token spelling, patterns and duplicate levels', () => {
    const c = clone()
    c.chats[0]!.answer = 3
    c.sentences[0]!.tokens[0]!.surface = 'درود'
    c.sentences[1]!.en = '[I want water'
    c.units[0]!.levels[1]!.id = 'u01-s0'
    const errs = errors(c)
    expect(errs).toContainEqual('chat c_u01_001: answer 3 is out of range')
    expect(errs).toContainEqual(expect.stringContaining('do not spell fa'))
    expect(errs).toContainEqual(expect.stringContaining('s_u01_0002: pattern does not compile'))
    expect(errs).toContainEqual(expect.stringContaining('duplicate level id u01-s0'))
  })

  it('requires accepted answers to include the canonical Persian text', () => {
    const c = clone()
    c.sentences.find((s) => s.id === 's_u01_0003')!.faAccept = 'من نان می‌خواهم'
    expect(errors(c)).toContainEqual(
      expect.stringContaining('s_u01_0003: accepted answers do not include fa'),
    )
  })

  it('checks unit ordering: sections list every unit and lexemes are introduced before use', () => {
    const c = clone()
    const later = structuredClone(c.units[0]!)
    later.id = 'u02-later'
    later.levels = [{ id: 'u02-l1', kind: 'practice', lessons: 1 }]
    c.units.push(later)
    expect(errors(c)).toContainEqual('unit u02-later is not listed in any course section')
    c.course!.sections[0]!.units.push('u02-later')
    c.lexemes.find((l) => l.id === 'lx_ab')!.introducedIn = 'u02-later'
    expect(errors(c)).toContainEqual(
      expect.stringContaining('lexeme lx_ab is introduced in u02-later, after u01-fixture'),
    )
  })

  it('reports YAML and schema problems with the file they came from', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'course.yaml'), 'id: [unclosed\n')
    mkdirSync(join(dir, 'lexemes'))
    writeFileSync(join(dir, 'lexemes/a.yaml'), '- id: lx_x\n  fa: ایکس\n')
    const c = loadCourse(dir)
    const issues = validateCourse(c, { allowDrafts: true })
    expect(hasErrors(issues)).toBe(true)
    expect(issues).toContainEqual(
      expect.objectContaining({
        file: 'course.yaml',
        message: expect.stringContaining('YAML parse error'),
      }),
    )
    expect(issues).toContainEqual(
      expect.objectContaining({
        file: 'lexemes/a.yaml',
        message: expect.stringContaining('lexeme lx_x: translit'),
      }),
    )
    expect(issues).toContainEqual(
      expect.objectContaining({ file: 'letters.yaml', message: 'missing letters.yaml' }),
    )
  })
})

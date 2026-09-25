import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Manifest } from '@zaboon/content-schema'
import { compile } from '@zaboon/grader'
import { buildCourse, compareBundle, writeBundle } from './build'
import { bankPool, unsafeBankTiles } from './distractors'
import { fixPersianText, lintPersian } from './lint'
import { loadCourse, type LoadedCourse } from './load'
import { repoRoot } from './paths'
import { containsLetter, validateCourse, type ValidateOptions } from './validate'

const FIXTURES = join(repoRoot(), 'content/fixtures')
const fixtures = loadCourse(FIXTURES)
const clone = (): LoadedCourse => structuredClone(fixtures)
const issues = (c: LoadedCourse, opts: Partial<ValidateOptions> = {}) =>
  validateCourse(c, { allowDrafts: false, ...opts })
const errors = (c: LoadedCourse, opts: Partial<ValidateOptions> = {}) =>
  issues(c, opts)
    .filter((i) => i.severity === 'error')
    .map((i) => i.message)
const lexeme = (c: LoadedCourse, id: string) => c.lexemes.find((l) => l.id === id)!
const sentence = (c: LoadedCourse, id: string) => c.sentences.find((s) => s.id === id)!

const dirs: string[] = []
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'zaboon-pipeline-'))
  dirs.push(d)
  return d
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('validate: normalization lint', () => {
  it('rejects Arabic yeh/kaf, Arabic-Indic digits, ASCII ? ; , tatweel and ZWJ in Persian fields', () => {
    const c = clone()
    lexeme(c, 'lx_ab').fa = 'آبي'
    lexeme(c, 'lx_nun').forms = { pl: 'نونك' }
    sentence(c, 's_u01_0001').fa = 'سلام, خوبی?'
    sentence(c, 's_u01_0002').faFormal = 'من ٣ آب می‌خواهم'
    c.characters[0]!.nameFa = 'ليلا'
    c.variants.push(['خوبـی', 'خوبی'])
    const errs = errors(c)
    expect(errs).toContainEqual('lexeme lx_ab fa: Arabic yeh (ي/ى); use Persian ی (U+06CC)')
    expect(errs).toContainEqual('lexeme lx_nun forms.pl: Arabic kaf (ك); use Persian ک (U+06A9)')
    expect(errs).toContainEqual('sentence s_u01_0001 fa: ASCII "?"; use ؟ (U+061F)')
    expect(errs).toContainEqual('sentence s_u01_0001 fa: ASCII ","; use ، (U+060C)')
    expect(errs).toContainEqual(
      expect.stringMatching(/^sentence s_u01_0002 faFormal: Arabic-Indic digit/),
    )
    expect(errs).toContainEqual(expect.stringMatching(/^character leila nameFa: Arabic yeh/))
    expect(errs).toContainEqual(expect.stringMatching(/^variant set \d+\[0\]: tatweel/))
  })

  it('fixes what it can', () => {
    expect(fixPersianText('سلام, خوبي? ٢ تا; كتاب')).toBe('سلام، خوبی؟ ۲ تا؛ کتاب')
    expect(lintPersian('سلام، خوبی؟').map((r) => r.id)).toEqual([])
    expect(lintPersian('a‍b').map((r) => r.id)).toEqual(['zwj'])
  })
})

describe('validate: distractors', () => {
  it('rejects a pinned lexeme distractor that shares a gloss, the Persian or the image', () => {
    const c = clone()
    lexeme(c, 'lx_nun').glosses = ['Water']
    lexeme(c, 'lx_chay').image = lexeme(c, 'lx_ab').image
    const errs = errors(c)
    expect(errs).toContainEqual(
      'level u01-l1 pinned[0] (select_image): distractor lx_nun could also be a correct answer (shared gloss "Water")',
    )
    expect(errs).toContainEqual(
      expect.stringContaining('distractor lx_chay could also be a correct answer (same image'),
    )
  })

  it('rejects a pinned sentence distractor whose answer the target accepts', () => {
    const c = clone()
    const level = c.units[0]!.levels.find((l) => l.id === 'u01-l1')!
    level.spec!.pinned[1]!.distractors = ['s_u01_0005', 's_u01_0003']
    sentence(c, 's_u01_0003').en = 'Hello, how are you?'
    expect(errors(c)).toContainEqual(
      'level u01-l1 pinned[1] (select_translation): distractor s_u01_0003 could also be a correct answer (its English "Hello, how are you?" is an accepted answer)',
    )
  })

  it('rejects word-bank tiles that can complete an accepted answer', () => {
    const c = clone()
    // "[I want/I'd like] [some/] water" (model answer "I want some water"): first glosses "I'd"
    // and "like" would let the bank build "I'd like some water".
    lexeme(c, 'lx_sib').glosses = ["I'd", 'apple']
    lexeme(c, 'lx_chay').glosses = ['like', 'tea']
    expect(errors(c)).toContainEqual(
      `level u01-l1 pinned[2] (translate_bank): word-bank distractor(s) "I'd", "like" can form an accepted answer for s_u01_0002`,
    )
  })

  it('finds unsafe tiles, including multi-tile completions, and ignores harmless ones', () => {
    const g = compile(["[I want/I'd like] [some/] water"], { lang: 'en' })
    // "some" is already one of the answer's own words; "like" needs "I'd" as well.
    expect(unsafeBankTiles(g, 'en', ['bread', 'some', 'like'])).toEqual([])
    expect(unsafeBankTiles(g, 'en', ['bread', "I'd", 'like'])).toEqual(["I'd", 'like'])
    expect(unsafeBankTiles(g, 'en', ['Water', 'tea'])).toEqual([])
    const fa = compile(['[من/] نون [می‌خوام/می‌خواهم]'], { lang: 'fa' })
    expect(unsafeBankTiles(fa, 'fa', ['آب', 'می‌خواهم'])).toEqual(['می‌خواهم'])
    expect(bankPool([lexeme(fixtures, 'lx_ab')], 'en')).toEqual(['water'])
  })

  it('rejects a chat option that is as right as the answer', () => {
    const c = clone()
    sentence(c, 's_u01_0003').en = sentence(c, 's_u01_0008').en
    expect(errors(c)).toContainEqual(
      expect.stringMatching(/^chat c_u01_001: option s_u01_0003 could also be the right reply/),
    )
  })
})

describe('validate: letters, media sign-off, migrations and unused items', () => {
  it('requires example words that contain the letter', () => {
    const c = clone()
    const be = c.letters!.letters.find((l) => l.id === 'l_be')!
    be.examples = ['lx_man']
    c.letters!.letters.find((l) => l.id === 'l_dal')!.examples = []
    const errs = errors(c)
    expect(errs).toContainEqual('letter l_be: example lx_man (من) does not contain ب')
    expect(errs).toContainEqual('letter l_dal: no example words')
    expect(containsLetter('آب', 'ا')).toBe(true)
  })

  it('requires native sign-off on approved sentence audio, except in the fixture course', () => {
    const c = clone()
    expect(errors(c)).toEqual([])
    const strict = errors(c, { requireMediaSignOff: true })
    expect(strict).toContainEqual(
      'sentence s_u01_0001: approved audio needs native sign-off (audio.signedOffBy)',
    )
    for (const s of c.sentences) if (s.audio) s.audio.signedOffBy = 'native-01'
    expect(errors(c, { requireMediaSignOff: true })).toEqual([])
    const draft = clone()
    draft.course!.id = 'fa-test'
    sentence(draft, 's_u01_0001').status = 'draft'
    expect(errors(draft, { allowDrafts: true })).not.toContainEqual(
      expect.stringContaining('s_u01_0001: approved audio'),
    )
  })

  it('warns about items no level uses (not in the fixture course, which keeps spares)', () => {
    expect(issues(fixtures)).toEqual([])
    const warnings = issues(fixtures, { warnUnused: true }).map((i) => `${i.severity} ${i.message}`)
    expect(warnings).toEqual([
      'warning lexeme lx_to is not used by any level',
      'warning sentence s_u01_0004 is not used by any level',
    ])
  })

  it('checks path migrations and passes them through to the manifest', () => {
    const dir = join(temp(), 'fixtures')
    cpSync(FIXTURES, dir, { recursive: true })
    writeFileSync(
      join(dir, 'path-migrations.yaml'),
      '- from: 1\n  to: 2\n  levels: { u01-old: u01-l1, u01-gone: null }\n',
    )
    const c = loadCourse(dir)
    expect(issues(c)).toEqual([])
    const manifest = Manifest.parse(
      JSON.parse(
        buildCourse(c, { version: 2, allowDrafts: false })
          .files.get('v2/manifest.json')!
          .toString(),
      ),
    )
    expect(manifest.pathMigrations).toEqual([
      { from: 1, to: 2, levels: { 'u01-old': 'u01-l1', 'u01-gone': null } },
    ])
    c.pathMigrations = [{ from: 3, to: 3, levels: { a: 'u01-nope' } }]
    expect(errors(c)).toEqual([
      'migration 1 (v3 → v3): "to" must be after "from"',
      'migration 1 (v3 → v3): a → unknown level u01-nope',
    ])
    writeFileSync(join(dir, 'path-migrations.yaml'), '- from: one\n')
    expect(errors(loadCourse(dir)).join('\n')).toContain('path migrations: 0.from')
  })
})

describe('build --check', () => {
  const now = new Date('2026-09-25T00:00:00Z')
  it('passes for an identical rebuild and reports changed, missing and unexpected files', () => {
    const out = temp()
    writeBundle(buildCourse(fixtures, { version: 1, allowDrafts: false, now }), out)
    const again = buildCourse(fixtures, {
      version: 1,
      allowDrafts: false,
      now: new Date('2027-01-01T00:00:00Z'),
    })
    expect(compareBundle(again, out)).toEqual([])

    const changed = clone()
    sentence(changed, 's_u01_0001').en = 'Hi there'
    expect(compareBundle(buildCourse(changed, { version: 1, allowDrafts: false }), out)).toEqual([
      { path: 'v1/build-info.json', problem: 'changed' },
      { path: 'v1/units/u01-fixture.json', problem: 'changed' },
    ])
    writeFileSync(join(out, 'fixture/v1/extra.json'), '{}')
    rmSync(join(out, 'fixture/v1/letters.json'))
    expect(compareBundle(again, out)).toEqual([
      { path: 'v1/extra.json', problem: 'unexpected' },
      { path: 'v1/letters.json', problem: 'missing' },
    ])
  })
})

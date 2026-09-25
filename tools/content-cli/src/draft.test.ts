import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  AiClient,
  chatResponse,
  MemoryBudgetLedger,
  MockTransport,
  type ChatRequest,
} from '@zaboon/ai'
import { createAiContext, MissingKeyError, printDryRun } from './ai-context'
import { draftUnit, loadBrief, UnitBrief, type DraftOutput } from './draft'
import { goodDraft } from './fixtures/draft-u02'
import { loadCourse } from './load'
import { repoRoot } from './paths'
import { validateCourse } from './validate'
import { TEST_KEY } from './fixtures/test-key'

const dirs: string[] = []
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'zaboon-draft-'))
  dirs.push(d)
  return d
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

/** A private copy of the seed course, so drafts never touch content/. */
function seedCopy(): string {
  const dir = join(temp(), 'fa-en')
  cpSync(join(repoRoot(), 'content/fa-en'), dir, { recursive: true })
  return dir
}

const brief = UnitBrief.parse({
  unit: 'u02-about-me',
  theme: "Say where you're from",
  grammar: ['اهل + place + copula ending'],
  vocabulary: { new: ['from (a place)', 'Iran', 'where'] },
  levels: 1,
  sentencesPerLevel: 2,
  chatsPerLevel: 1,
})

const respondWith = (...drafts: DraftOutput[]) =>
  new MockTransport(() =>
    chatResponse(JSON.stringify(drafts.length > 1 ? drafts.shift() : drafts[0]), { cost: 0.05 }),
  )

describe('draft', () => {
  it('writes status: draft YAML in the house layout that passes validate --allow-drafts', async () => {
    const dir = seedCopy()
    const transport = respondWith(goodDraft())
    const ai = new AiClient({ apiKey: TEST_KEY, transport, budget: new MemoryBudgetLedger(10) })
    const now = new Date('2026-09-25T12:00:00Z')
    const result = await draftUnit({ course: loadCourse(dir), brief, ai, now })
    expect(result.errors).toEqual([])
    expect(result.written.sort()).toEqual([
      'chats/u02-about-me.yaml',
      'guidebooks/u02-about-me.md',
      'lexemes/u02-about-me.yaml',
      'sentences/u02-about-me.yaml',
      'units/u02-about-me.yaml',
    ])

    const course = loadCourse(dir)
    expect(
      validateCourse(course, { allowDrafts: true }).filter((i) => i.severity === 'error'),
    ).toEqual([])
    const s = course.sentences.filter((x) => x.unit === 'u02-about-me')
    expect(s.map((x) => x.id)).toEqual(['s_u02_0001', 's_u02_0002'])
    expect(s[1]!.fa).toBe('تو اهل کجایی؟')
    expect(s[0]!.tokens[2]!.surface).toBe('ایرانم')
    expect(s[0]!.provenance).toEqual({
      model: 'openai/gpt-6-astra',
      prompt: 'draft-unit@1',
      generatedAt: '2026-09-25T12:00:00.000Z',
    })
    expect(s.every((x) => x.status === 'draft')).toBe(true)
    const koja = course.lexemes.find((l) => l.id === 'lx_koja')!
    expect([koja.fa, koja.forms]).toEqual(['کجا', { '2sg': 'کجایی' }])
    expect(course.chats.find((c) => c.id === 'c_u02_001')).toMatchObject({
      prompt: 's_u02_0002',
      options: ['s_u02_0001', 's_u01_0005'],
    })
    const unit = course.units.find((u) => u.id === 'u02-about-me')!
    expect(unit.levels.map((l) => l.id)).toEqual(['u02-l1', 'u02-p1', 'u02-review'])
    expect(unit.levels[0]!.spec!.focus).toMatchObject({
      lexemes: ['lx_ahl', 'lx_iran', 'lx_koja'],
      chats: ['c_u02_001'],
    })
    expect(unit.guidebook).toBe('guidebooks/u02-about-me.md')
    expect(unit.provenance).toMatchObject({ author: 'claude-seed', prompt: 'draft-unit@1' })

    // House layout: blank-line separated items, one-line token and provenance maps, no folding.
    const yaml = readFileSync(join(dir, 'sentences/u02-about-me.yaml'), 'utf8')
    expect(yaml).toMatch(/^# About me: sentences\. AI draft/)
    expect(yaml).toContain('\n\n- id: s_u02_0002\n')
    expect(yaml).toContain('  - { surface: من, lexeme: lx_man, translit: man, gloss: "I" }\n')
    expect(yaml).toContain('  provenance: { model: openai/gpt-6-astra, prompt: draft-unit@1,')
    expect(yaml).toContain('  audio: { speaker: kian }\n')
  })

  it('sends the style guide, the seed unit as exemplar and the brief, with a JSON schema', async () => {
    const dir = seedCopy()
    const transport = respondWith(goodDraft())
    await draftUnit({
      course: loadCourse(dir),
      brief,
      ai: new AiClient({ apiKey: TEST_KEY, transport }),
    })
    const req: ChatRequest = transport.calls[0]!
    expect(req.model).toBe('openai/gpt-6-astra')
    expect(req.response_format?.json_schema).toMatchObject({ name: 'unit_draft', strict: true })
    const system = req.messages[0]!.content as string
    const user = req.messages[1]!.content as string
    expect(system).toContain('Zaboon house style: writing Persian')
    expect(user).toContain('## sentences/u01-hello.yaml')
    expect(user).toContain('- id: s_u01_0002')
    expect(user).toContain("Theme: Say where you're from")
    expect(user).toContain('lx_salam | سلام | salām')
    expect(user).not.toMatch(/duolingo/i)
  })

  it('sends validator errors back for one repair round', async () => {
    const dir = seedCopy()
    const bad = goodDraft()
    bad.sentences[0]!.tokens[0]!.lexeme = 'lx_nope'
    bad.chats[0]!.answer = 5
    const transport = respondWith(bad, goodDraft())
    const r = await draftUnit({
      course: loadCourse(dir),
      brief,
      ai: new AiClient({ apiKey: TEST_KEY, transport }),
    })
    expect(r).toMatchObject({ repaired: true, errors: [] })
    expect(transport.calls).toHaveLength(2)
    const feedback = transport.calls[1]!.messages.at(-1)!.content as string
    expect(feedback).toContain('lx_nope')
    expect(feedback).toContain('answer 5 is out of range')
  })

  it('writes nothing when the repair still fails', async () => {
    const dir = seedCopy()
    const bad = goodDraft()
    bad.sentences[1]!.en = ['[Where are you from?']
    const r = await draftUnit({
      course: loadCourse(dir),
      brief,
      ai: new AiClient({ apiKey: TEST_KEY, transport: respondWith(bad) }),
    })
    expect(r.written).toEqual([])
    expect(r.errors.join('\n')).toContain('pattern does not compile')
    expect(existsSync(join(dir, 'sentences/u02-about-me.yaml'))).toBe(false)
  })

  it('refuses to overwrite a draft without --force, and never redrafts an approved unit', async () => {
    const dir = seedCopy()
    writeFileSync(join(dir, 'lexemes/u02-about-me.yaml'), '[]\n')
    const ai = new AiClient({ apiKey: TEST_KEY, transport: respondWith(goodDraft()) })
    await expect(draftUnit({ course: loadCourse(dir), brief, ai })).rejects.toThrow(/--force/)
    await expect(
      draftUnit({ course: loadCourse(dir), brief, ai, force: true }),
    ).resolves.toMatchObject({ errors: [] })
    const approved = loadCourse(dir)
    approved.units.find((u) => u.id === 'u02-about-me')!.status = 'approved'
    await expect(draftUnit({ course: approved, brief, ai })).rejects.toThrow(/approved/)
  })

  it('dry run: prints prompts and a cost estimate without a key or a client', async () => {
    const r = await draftUnit({ course: loadCourse(seedCopy()), brief, dryRun: true })
    const lines: string[] = []
    const total = printDryRun([r.dryRun!], (l) => lines.push(l))
    expect(total).toBeGreaterThan(0.8) // up to 16k output tokens at $50/M
    expect(lines[0]).toMatch(/^── draft u02-about-me · openai\/gpt-6-astra · ~\d+ input tokens/)
    expect(lines.at(-1)).toContain('nothing was sent')
  })

  it('reads the build key from the environment, caches responses and records spend', async () => {
    expect(() => createAiContext({ env: {}, root: temp() })).toThrow(MissingKeyError)
    const root = temp()
    const dir = seedCopy()
    const transport = respondWith(goodDraft())
    const env = { OPENROUTER_API_KEY_BUILD: TEST_KEY }
    const ctx = createAiContext({ env, root, transport, budgetUsd: 5 })
    await draftUnit({ course: loadCourse(dir), brief, ai: ctx.ai })
    const again = createAiContext({ env, root, transport, budgetUsd: 5 })
    const r = await draftUnit({ course: loadCourse(dir), brief, ai: again.ai, force: true })
    expect(r.costUsd).toBe(0)
    expect(transport.calls).toHaveLength(1)
    expect(await again.budget.spent()).toBe(0.05)
  })

  it('loads and checks brief files', () => {
    const file = join(temp(), 'brief.yaml')
    writeFileSync(file, 'unit: u02-about-me\ntheme: Where are you from\n')
    expect(loadBrief(file)).toMatchObject({
      unit: 'u02-about-me',
      levels: 3,
      vocabulary: { new: [] },
    })
    writeFileSync(file, 'unit: U2\n')
    expect(() => loadBrief(file)).toThrow(/invalid brief/)
  })
})

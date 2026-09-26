import { describe, expect, it } from 'vitest'
import {
  AnswerGraph,
  CONTENT_SCHEMA_VERSION,
  ItemRef,
  Level,
  Lexeme,
  LessonSpec,
  Sentence,
  Story,
  StoryId,
  StoryLine,
  StoryQuestion,
  UnitBundle,
  itemRef,
  parseItemRef,
  patternList,
  Provenance,
} from './index'

const prov = { author: 'test' }

// P2 stories: the fixture story of the Wave 4 design (docs: content/fixtures, st_u01_tea).
const line = (speaker: string | null, fa: string, translit: string, en: string) => ({
  speaker,
  fa,
  translit,
  en,
  tokens: fa
    .replace(/[،؟]/g, '')
    .split(' ')
    .map((surface, i) => ({ surface, translit: translit.split(' ')[i] ?? translit })),
})
const story = {
  id: 'st_u01_tea',
  unit: 'u01-fixture',
  title: 'Tea with Leila',
  titleFa: 'چای با لیلا',
  image: 'img/tea.svg',
  characters: ['leila', 'hodhod'],
  lines: [
    { ...line('leila', 'سلام، خوبی؟', 'salām khubi', 'Hello, how are you?'), audio: 'audio/s.mp3' },
    line('hodhod', 'خوبم، مرسی', 'khubam mersi', "I'm good, thanks"),
    line('leila', 'چای می‌خوای؟', 'chāy mikhāy', 'Do you want tea?'),
    line('hodhod', 'نون می‌خوام', 'nun mikhām', 'I want bread'),
    line(null, 'مرسی', 'mersi', 'Thanks'),
  ],
  questions: [
    {
      after: 3,
      prompt: { lang: 'en', text: 'What does Leila offer?' },
      choices: ['tea', 'water', 'bread'],
      answer: 0,
    },
    {
      after: 4,
      prompt: { lang: 'en', text: 'What does Hodhod want?' },
      choices: ['bread', 'tea', 'apples'],
      answer: 0,
    },
  ],
  status: 'approved',
  provenance: prov,
}
const unitBundle = {
  schema: CONTENT_SCHEMA_VERSION,
  unit: {
    id: 'u01-fixture',
    title: 'Hello',
    color: 'firouzeh',
    levels: [{ id: 'u01-s0', kind: 'lesson' }],
    status: 'approved',
    provenance: prov,
  },
  lexemes: [],
  sentences: [],
}

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

describe('content-schema: stories (P2)', () => {
  it('parses a story; a null speaker is the narrator', () => {
    const parsed = Story.parse(story)
    expect(parsed).toEqual(story)
    expect(parsed.lines.at(-1)!.speaker).toBeNull()
    expect(StoryLine.parse(story.lines[0]).audio).toBe('audio/s.mp3')
    expect(StoryQuestion.parse(story.questions[0]).after).toBe(3)
  })

  it('story ids start with st_', () => {
    expect(StoryId.parse('st_u01_tea')).toBe('st_u01_tea')
    for (const id of ['story_1', 'st-u01-tea', 'st_U01', 'st_', 'u01_tea'])
      expect(StoryId.safeParse(id).success, id).toBe(false)
  })

  it('rejects each invalid story shape', () => {
    const [first, ...rest] = story.lines
    const [q, ...qs] = story.questions
    const withLine = (patch: object) => ({ ...story, lines: [{ ...first, ...patch }, ...rest] })
    const withQuestion = (patch: object) => ({ ...story, questions: [{ ...q, ...patch }, ...qs] })
    const { en: _en, ...noEn } = first!
    const invalid: Record<string, unknown> = {
      'bad id': { ...story, id: 'u01_tea' },
      'bad unit': { ...story, unit: 'unit one' },
      'empty title': { ...story, title: '' },
      'unknown image type': { ...story, image: 'img/tea.gif' },
      'no characters': { ...story, characters: [] },
      'bad character id': { ...story, characters: ['Leila'] },
      'one line': { ...story, lines: [first] },
      '41 lines': { ...story, lines: Array.from({ length: 41 }, () => first) },
      'no questions': { ...story, questions: [] },
      '9 questions': { ...story, questions: Array.from({ length: 9 }, () => q) },
      'unknown status': { ...story, status: 'published' },
      'no provenance author or model': { ...story, provenance: {} },
      'bad speaker id': withLine({ speaker: 'Leila' }),
      'no tokens': withLine({ tokens: [] }),
      'empty fa': withLine({ fa: '' }),
      'no translation': { ...story, lines: [noEn, ...rest] },
      'uppercase audio path': withLine({ audio: 'audio/S.MP3' }),
      'question after 0': withQuestion({ after: 0 }),
      'one choice': withQuestion({ choices: ['tea'] }),
      'five choices': withQuestion({ choices: ['a', 'b', 'c', 'd', 'e'] }),
      'empty choice': withQuestion({ choices: ['tea', ''] }),
      'negative answer': withQuestion({ answer: -1 }),
      'unknown prompt language': withQuestion({ prompt: { lang: 'de', text: 'Was?' } }),
    }
    for (const [name, value] of Object.entries(invalid))
      expect(Story.safeParse(value).success, name).toBe(false)
  })

  it('a level may name its story; levels without one still parse', () => {
    expect(Level.parse({ id: 'u01-st1', kind: 'story', story: 'st_u01_tea' }).story).toBe(
      'st_u01_tea',
    )
    expect(Level.parse({ id: 'u01-s0', kind: 'lesson' })).toEqual({
      id: 'u01-s0',
      kind: 'lesson',
      lessons: 1,
    })
    expect(Level.safeParse({ id: 'u01-st1', kind: 'story', story: 'tea' }).success).toBe(false)
  })

  it('unit bundles carry stories; a bundle built before stories parses to []', () => {
    expect(UnitBundle.parse(unitBundle).stories).toEqual([])
    expect(UnitBundle.parse({ ...unitBundle, stories: [story] }).stories).toEqual([story])
    const broken = { ...unitBundle, stories: [{ ...story, lines: [] }] }
    expect(UnitBundle.safeParse(broken).success).toBe(false)
    expect(CONTENT_SCHEMA_VERSION).toBe(1)
  })

  it('story beats are not item refs (no mistakes or SRS rows)', () => {
    expect(ItemRef.safeParse('story:st_u01_tea').success).toBe(false)
  })
})

/**
 * Session-engine behaviour on the frozen fixture course and on content/fa-en, loaded straight from
 * YAML (test-support/load-course.ts). Covers every builder, the pinned fixture lessons, the new-word
 * ladder, review and mistake mixing, letters sessions, distractor rules and rebuild determinism.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  Challenge,
  DEFAULT_APP_CONFIG as cfg,
  MVP_CHALLENGE_TYPES,
  PracticeMode,
} from '@zaboon/contracts'
import type { ChallengeOf, ChallengeRef, FsrsCard, SessionKind } from '@zaboon/contracts'
import type { LessonSpec, UnitBundle } from '@zaboon/content-schema'
import { accepts } from '@zaboon/grader'
import { newCard, review } from '@zaboon/srs'
import {
  ContentError,
  IMPLEMENTATION,
  NotImplementedError,
  allocate,
  buildChallenge,
  decodeVariant,
  encodeVariant,
  generateSession,
  gradeResponse,
  mvpTwin,
  rebuildChallenges,
  TRACE_FORMS,
} from './index'
import type { ContentView, GenerateInput, LearnerState, SessionFeatures } from './index'
import { acceptedTokenKeys, answerTiles, indexContent, wordKey } from './content'
import { loadCourse } from './test-support/load-course'

const fixture = loadCourse('fixtures')
const faEn = loadCourse('fa-en')
const fx = fixture.view('u01-fixture')
const now = new Date('2026-09-25T12:00:00Z')
const fresh: LearnerState = { lexemeCards: {}, letterCards: {}, mistakes: [], exposures: {} }

function gen(content: ContentView, over: Partial<GenerateInput> = {}) {
  return generateSession({
    content,
    kind: 'lesson',
    levelId: null,
    lessonIndex: 0,
    learner: fresh,
    seed: 'seed-1',
    now,
    config: cfg,
    ...over,
  })
}

const refLine = (r: ChallengeRef) => ({ type: r.type, items: r.items, direction: r.direction })
const of = <T extends Challenge['type']>(c: Challenge, t: T) => {
  expect(c.type).toBe(t)
  return c as ChallengeOf<T>
}

/** A copy of the fixture unit where `levelId` is generated from `spec` instead of pinned. */
function withSpec(view: ContentView, spec: Partial<LessonSpec>, levelId = 'u01-gen'): ContentView {
  const unit = view.unit!
  const base: LessonSpec = {
    focus: { lexemes: [], sentences: [], letters: [], chats: [] },
    mix: 'intro',
    pinned: [],
    pinnedOnly: false,
  }
  const bundle: UnitBundle = {
    ...unit,
    unit: {
      ...unit.unit,
      levels: [
        ...unit.unit.levels,
        { id: levelId, kind: 'lesson', lessons: 3, spec: { ...base, ...spec } },
      ],
    },
  }
  return { ...view, unit: bundle }
}

/** A learner who has reviewed `ids` once; `dueIds` are overdue at `now`. */
function cards(ids: readonly string[], dueIds: readonly string[] = []): Record<string, FsrsCard> {
  const past = new Date(now.getTime() - 60 * 86_400_000)
  return Object.fromEntries(
    ids.map((id) => {
      const c = review(newCard(past), 'good', past)
      return [
        id,
        dueIds.includes(id)
          ? c
          : { ...c, due: new Date(now.getTime() + 30 * 86_400_000).toISOString() },
      ]
    }),
  )
}

describe('session-engine', () => {
  it('is the real implementation', () => {
    expect(IMPLEMENTATION).toBe('real')
  })

  describe('pinned fixture lessons', () => {
    it('u01-s0 builds exactly its four pins, in order', () => {
      const s = gen(fx, { levelId: 'u01-s0' })
      expect(s.refs.map(refLine)).toEqual([
        { type: 'select_translation', items: ['s_u01_0001'], direction: 'fa_en' },
        { type: 'translate_bank', items: ['s_u01_0002'], direction: 'fa_en' },
        { type: 'translate_type', items: ['s_u01_0006'], direction: 'fa_en' },
        {
          type: 'match_pairs',
          items: ['lx_salam', 'lx_mersi', 'lx_maman', 'lx_baba', 'lx_khub'],
          direction: undefined,
        },
      ])
      expect(s.challenges.map((c) => c.type)).toEqual([
        'select_translation',
        'translate_bank',
        'translate_type',
        'match_pairs',
      ])
      expect(s.challenges.every((c) => !c.isNew)).toBe(true)
    })

    it('u01-t1 pins the Wave 3 types (typed Persian, tracing) after every MVP level', () => {
      const levels = fixture.units[0]!.levels
      expect(levels.at(-1)!.id).toBe('u01-t1')
      const spec = levels.at(-1)!.spec!
      expect(spec.pinnedOnly).toBe(true)
      expect(spec.pinned.map(refLine)).toEqual([
        { type: 'translate_type', items: ['s_u01_0003'], direction: 'en_fa' },
        { type: 'listen_type', items: ['s_u01_0005'], direction: undefined },
        { type: 'cloze_type', items: ['s_u01_0007'], direction: undefined },
        { type: 'letter_trace', items: ['l_be'], direction: undefined },
      ])
      // With both features on it builds exactly the four pins.
      const on = gen(fx, {
        levelId: 'u01-t1',
        features: { persianTyping: true, letterTrace: true },
      })
      expect(on.refs).toEqual([
        { type: 'translate_type', items: ['s_u01_0003'], direction: 'en_fa' },
        { type: 'listen_type', items: ['s_u01_0005'] },
        { type: 'cloze_type', items: ['s_u01_0007'] },
        { type: 'letter_trace', items: ['l_be'] },
      ])
      expect(on.challenges.map((c) => c.type)).toEqual([
        'translate_type',
        'listen_type',
        'cloze_type',
        'letter_trace',
      ])
      expect(of(on.challenges[0]!, 'translate_type').answerLang).toBe('fa')
      expect(of(on.challenges[3]!, 'letter_trace').form).toBe('isolated')
      expect(rebuildChallenges(on.refs, fx)).toEqual(on.challenges)
    })

    it('u01-t1 plays the MVP twins in place while the features are off', () => {
      for (const features of [undefined, { persianTyping: false, letterTrace: false }]) {
        const off = gen(fx, { levelId: 'u01-t1', ...(features ? { features } : {}) })
        expect(off.refs).toEqual([
          { type: 'translate_bank', items: ['s_u01_0003'], direction: 'en_fa' },
          { type: 'listen_tap', items: ['s_u01_0005'] },
          { type: 'cloze_choice', items: ['s_u01_0007'] },
          { type: 'letter_forms', items: ['l_be'] },
        ])
        expect(off.challenges.every((c) => MVP_CHALLENGE_TYPES.includes(c.type as never))).toBe(
          true,
        )
        // Stored refs hold what was built, so the rebuild never needs the flags.
        expect(rebuildChallenges(off.refs, fx)).toEqual(off.challenges)
      }
      // One feature at a time.
      const typingOnly = gen(fx, { levelId: 'u01-t1', features: { persianTyping: true } })
      expect(typingOnly.refs.map((r) => r.type)).toEqual([
        'translate_type',
        'listen_type',
        'cloze_type',
        'letter_forms',
      ])
      const traceOnly = gen(fx, { levelId: 'u01-t1', features: { letterTrace: true } })
      expect(traceOnly.refs.map((r) => r.type)).toEqual([
        'translate_bank',
        'listen_tap',
        'cloze_choice',
        'letter_trace',
      ])
    })

    it('mvpTwin leaves English typing and MVP refs alone', () => {
      const en: ChallengeRef = { type: 'translate_type', items: ['s_u01_0006'], direction: 'fa_en' }
      expect(mvpTwin(en, undefined)).toBe(en)
      const bank: ChallengeRef = { type: 'listen_tap', items: ['s_u01_0005'] }
      expect(mvpTwin(bank, undefined)).toBe(bank)
      expect(
        mvpTwin(
          { type: 'letter_trace', items: ['l_be'], variant: encodeVariant({ option: 2 }) },
          {},
        ),
      ).toEqual({ type: 'letter_forms', items: ['l_be'] })
    })

    it('u01-l1 and u01-l2 together build all 13 MVP types in the pinned order', () => {
      const l1 = gen(fx, { levelId: 'u01-l1' })
      const l2 = gen(fx, { levelId: 'u01-l2' })
      expect(l1.challenges.map((c) => c.type)).toEqual([
        'select_image',
        'select_translation',
        'translate_bank',
        'translate_bank',
        'translate_type',
        'match_pairs',
        'listen_tap',
        'cloze_choice',
        'complete_chat',
      ])
      expect(l2.challenges.map((c) => c.type)).toEqual([
        'letter_intro',
        'letter_sound',
        'letter_forms',
        'read_word',
        'build_word',
      ])
      expect(new Set([...l1.challenges, ...l2.challenges].map((c) => c.type))).toEqual(
        new Set(MVP_CHALLENGE_TYPES),
      )
      for (const c of [...l1.challenges, ...l2.challenges])
        expect(() => Challenge.parse(c)).not.toThrow()
    })

    it('every built challenge carries a correct, consistent answer key', () => {
      const ix = indexContent(fx)
      const [image, select, bankEn, bankFa, type, match, listen, cloze, chat] = gen(fx, {
        levelId: 'u01-l1',
      }).challenges
      const img = of(image!, 'select_image')
      expect(img.choices[img.answer]!.lexeme).toBe('lx_ab')
      expect(img.choices.map((c) => c.lexeme).sort()).toEqual([
        'lx_ab',
        'lx_chay',
        'lx_nun',
        'lx_sib',
      ])
      expect(img.choices.every((c) => c.image.startsWith('/media/fixtures/img/'))).toBe(true)

      const st = of(select!, 'select_translation')
      const s1 = ix.sentence('s_u01_0001')
      expect(accepts(s1.graphs.en, st.choices[st.answer]!.text, 'en')).toBe(true)
      st.choices.forEach(
        (ch, i) => i !== st.answer && expect(accepts(s1.graphs.en, ch.text, 'en')).toBe(false),
      )

      for (const b of [of(bankEn!, 'translate_bank'), of(bankFa!, 'translate_bank')]) {
        const model = b.answerLang === 'fa' ? ['نون', 'می‌خوام'] : answerTiles(b.graph)
        expect(accepts(b.graph, model, b.answerLang)).toBe(true)
        const extras = [...b.bank]
        for (const t of model) extras.splice(extras.indexOf(t), 1) // every model tile is in the bank
        expect(extras.length).toBeGreaterThan(0)
        const banned = acceptedTokenKeys(b.graph, b.answerLang)
        for (const t of extras) expect(banned.has(wordKey(t, b.answerLang))).toBe(false)
      }
      expect(of(bankFa!, 'translate_bank')).toMatchObject({
        direction: 'en_fa',
        answerLang: 'fa',
        prompt: { lang: 'en' },
      })

      const tt = of(type!, 'translate_type')
      expect(accepts(tt.graph, 'Mom is good', 'en')).toBe(true)

      const mp = of(match!, 'match_pairs')
      expect(mp.pairs.map((p) => p.en)).toEqual(['hello', 'thanks', 'mom', 'dad', 'good'])

      const lt = of(listen!, 'listen_tap')
      expect(lt.audio.normal).toBe('/media/fixtures/audio/s_u01_0005.mp3')
      expect(lt.bank).toEqual(expect.arrayContaining(['چای', 'می‌خوای']))
      expect(accepts(lt.graph, ['چای', 'می‌خوای'], 'fa')).toBe(true)

      const cz = of(cloze!, 'cloze_choice')
      const surfaces = (w: string) => [
        ...cz.before.map((t) => t.surface),
        w,
        ...cz.after.map((t) => t.surface),
      ]
      const s7 = ix.sentence('s_u01_0007')
      expect(accepts(s7.graphs.fa, surfaces(cz.choices[cz.answer]!), 'fa')).toBe(true)
      cz.choices.forEach(
        (w, i) => i !== cz.answer && expect(accepts(s7.graphs.fa, surfaces(w), 'fa')).toBe(false),
      )
      expect(cz.translation).toBe('I want an apple')

      const cc = of(chat!, 'complete_chat')
      expect(cc.speaker).toEqual({ id: 'leila', name: 'Leila' })
      expect(cc.choices[cc.answer]!.fa).toBe('خوبم، مرسی')
      expect(cc.prompt.en).toBe('Hello, how are you?')
    })

    it('letter challenges carry correct keys', () => {
      const [intro, sound, forms, read, build] = gen(fx, { levelId: 'u01-l2' }).challenges
      const li = of(intro!, 'letter_intro')
      expect(li.letter).toMatchObject({
        id: 'l_be',
        letter: 'ب',
        connects: true,
        audio: '/media/fixtures/audio/l_be.mp3',
      })
      expect(li.examples.map((e) => e.fa)).toEqual(['بابا', 'آب', 'سیب'])
      const ls = of(sound!, 'letter_sound')
      expect(ls.mode).toBe('letter_to_sound')
      expect(ls.choices[ls.answer]).toBe('b')
      expect(new Set(ls.choices).size).toBe(ls.choices.length)
      const lf = of(forms!, 'letter_forms')
      expect(lf.pairs.map((p) => p.left)).toEqual(['ب', 'م', 'ن'])
      lf.pairs.forEach((p) => expect(p.right.replace(/‍/g, '')).toBe(p.left))
      const rw = of(read!, 'read_word')
      expect(rw.choices[rw.answer]).toBe(rw.ask === 'translit' ? 'bābā' : 'dad')
      const bw = of(build!, 'build_word')
      expect(bw.answer).toEqual(['س', 'ی', 'ب'])
      expect(bw.tiles.length).toBeGreaterThan(bw.answer.length)
      for (const t of bw.answer) expect(bw.tiles).toContain(t)
    })

    it('rebuilds from JSON-stored refs exactly', () => {
      for (const levelId of ['u01-s0', 'u01-l1', 'u01-l2']) {
        const s = gen(fx, { levelId })
        const stored = JSON.parse(JSON.stringify(s.refs)) as ChallengeRef[]
        expect(rebuildChallenges(stored, fx)).toEqual(s.challenges)
        expect(JSON.parse(JSON.stringify(s.challenges))).toEqual(s.challenges)
      }
    })
  })

  describe('builders', () => {
    it('skip select_image and listen_tap when media is missing', () => {
      const ix = indexContent(fx)
      const noMedia: ContentView = {
        ...fx,
        knownLexemes: fx.knownLexemes.map(({ image: _i, audio: _a, ...l }) => l),
        knownSentences: fx.knownSentences.map(({ audio: _a, ...s }) => s),
        unit: { ...fx.unit!, lexemes: [], sentences: [] },
      }
      expect(ix.lexeme('lx_ab').image).toBeDefined()
      expect(() => buildChallenge({ type: 'select_image', items: ['lx_ab'] }, 0, noMedia)).toThrow(
        ContentError,
      )
      expect(() =>
        buildChallenge({ type: 'listen_tap', items: ['s_u01_0005'] }, 0, noMedia),
      ).toThrow(ContentError)
      const s = gen(
        withSpec(noMedia, {
          focus: {
            lexemes: ['lx_ab', 'lx_nun', 'lx_chay'],
            sentences: ['s_u01_0002', 's_u01_0003', 's_u01_0005'],
            letters: [],
            chats: [],
          },
        }),
        {
          levelId: 'u01-gen',
        },
      )
      expect(s.challenges.some((c) => c.type === 'select_image' || c.type === 'listen_tap')).toBe(
        false,
      )
      expect(s.challenges.length).toBe(cfg.session.lengths.lesson!)
    })

    it('encode isNew and options in variant', () => {
      expect(encodeVariant({})).toBeUndefined()
      expect(decodeVariant(encodeVariant({ isNew: true, option: 3 }))).toEqual({
        isNew: true,
        option: 3,
      })
      const c = buildChallenge(
        {
          type: 'letter_sound',
          items: ['l_be'],
          variant: encodeVariant({ option: 1, isNew: true }),
        },
        2,
        fx,
      )
      expect(c).toMatchObject({ index: 2, isNew: true, mode: 'sound_to_letter' })
      expect(of(c, 'letter_sound').choices[of(c, 'letter_sound').answer]).toBe('ب')
      const rw = buildChallenge(
        { type: 'read_word', items: ['lx_sib'], variant: encodeVariant({ option: 1 }) },
        0,
        fx,
      )
      expect(of(rw, 'read_word')).toMatchObject({ ask: 'meaning' })
      expect(of(rw, 'read_word').choices[of(rw, 'read_word').answer]).toBe('apple')
      const cz = buildChallenge(
        { type: 'cloze_choice', items: ['s_u01_0002'], variant: encodeVariant({ option: 2 }) },
        0,
        fx,
      )
      expect(of(cz, 'cloze_choice').choices[of(cz, 'cloze_choice').answer]).toBe('آب')
    })

    it('build single-word challenges for lexemes (ladder fallbacks)', () => {
      const tb = of(
        buildChallenge({ type: 'translate_bank', items: ['lx_sib'], direction: 'en_fa' }, 0, fx),
        'translate_bank',
      )
      expect(tb.prompt).toEqual({ lang: 'en', text: 'apple' })
      expect(accepts(tb.graph, ['سیب'], 'fa')).toBe(true)
      expect(tb.bank).toContain('سیب')
      const st = of(
        buildChallenge(
          { type: 'select_translation', items: ['lx_maman'], direction: 'fa_en' },
          0,
          fx,
        ),
        'select_translation',
      )
      expect(st.choices[st.answer]!.text).toBe('mom')
      const lt = of(buildChallenge({ type: 'listen_tap', items: ['lx_chay'] }, 0, fx), 'listen_tap')
      expect(lt.audio.normal).toBe('/media/fixtures/audio/lx_chay.mp3')
      expect(() => Challenge.parse(lt)).not.toThrow()
      const one = of(
        buildChallenge({ type: 'letter_forms', items: ['l_alef'] }, 0, fx),
        'letter_forms',
      )
      expect(one.pairs.length).toBeGreaterThanOrEqual(2)
    })

    it('never offer an accepted variant as a distractor', () => {
      const ix = indexContent(fx)
      // lx_khub glosses: good, well, fine. None of them may appear as a wrong choice.
      for (let i = 0; i < 40; i++) {
        const c = of(
          buildChallenge(
            { type: 'select_translation', items: ['lx_khub'], direction: 'fa_en' },
            i,
            fx,
          ),
          'select_translation',
        )
        c.choices.forEach(
          (ch, k) => k !== c.answer && expect(['good', 'well', 'fine']).not.toContain(ch.text),
        )
        const b = of(
          buildChallenge(
            { type: 'translate_bank', items: ['s_u01_0006'], direction: 'fa_en' },
            i,
            fx,
          ),
          'translate_bank',
        )
        const words = new Set([
          'mom',
          'mum',
          'mother',
          'mama',
          'is',
          'good',
          'well',
          'fine',
          'okay',
          'ok',
          "mom's",
          "mum's",
          "mama's",
        ])
        const extras = b.bank.filter((t) => !['Mom', 'is', 'good'].includes(t))
        extras.forEach((t) => expect(words.has(t.toLowerCase())).toBe(false))
      }
      expect(ix.lexeme('lx_khub').glosses).toEqual(['good', 'well', 'fine'])
    })

    it('reject unknown ids and later-phase types', () => {
      expect(() =>
        buildChallenge({ type: 'select_translation', items: ['s_nope'] }, 0, fx),
      ).toThrow(ContentError)
      expect(() => buildChallenge({ type: 'speak', items: ['s_u01_0001'] }, 0, fx)).toThrow(
        NotImplementedError,
      )
      expect(() => buildChallenge({ type: 'story', items: ['s_u01_0001'] }, 0, fx)).toThrow(
        /not available yet/,
      )
      expect(() =>
        buildChallenge({ type: 'match_pairs', items: ['lx_ab', 'lx_nun'] }, 0, fx),
      ).toThrow(ContentError)
    })
  })

  describe('generated lessons', () => {
    const focus = {
      lexemes: [
        'lx_ab',
        'lx_nun',
        'lx_chay',
        'lx_sib',
        'lx_salam',
        'lx_mersi',
        'lx_maman',
        'lx_baba',
        'lx_khub',
        'lx_man',
        'lx_mikham',
      ],
      sentences: [
        's_u01_0001',
        's_u01_0002',
        's_u01_0003',
        's_u01_0005',
        's_u01_0006',
        's_u01_0007',
        's_u01_0008',
      ],
      letters: [],
      chats: ['c_u01_001'],
    }
    const view = withSpec(fx, { focus, mix: 'intro' })

    it('run the new-word ladder: intro (isNew) → recognition → production → listening', () => {
      const s = gen(view, { levelId: 'u01-gen' })
      expect(s.challenges).toHaveLength(cfg.session.lengths.lesson!)
      const intros = s.challenges.filter((c) => c.isNew)
      expect(intros.map((c) => c.ref.items[0])).toEqual(['lx_ab', 'lx_nun', 'lx_chay'])
      expect(intros.every((c) => c.type === 'select_image')).toBe(true) // imaged words get pictures
      expect(s.challenges[0]!.isNew).toBe(true)
      expect(s.challenges[1]!.type).toBe('select_translation') // recognition right after the intro
      for (const [w, sentence] of [
        ['lx_ab', 's_u01_0002'],
        ['lx_nun', 's_u01_0003'],
        ['lx_chay', 's_u01_0005'],
      ] as const) {
        const at = s.challenges.findIndex((c) => c.isNew && c.ref.items[0] === w)
        const uses = (c: Challenge) => c.ref.items.includes(w) || c.ref.items.includes(sentence)
        const prod = s.challenges.findIndex(
          (c) => c.type === 'translate_bank' && c.ref.direction === 'en_fa' && uses(c),
        )
        const listen = s.challenges.findIndex((c) => c.type === 'listen_tap' && uses(c))
        expect(prod).toBeGreaterThan(at)
        expect(listen).toBeGreaterThan(at)
      }
    })

    it('introduce words without pictures with select_translation', () => {
      const s = gen(
        withSpec(fx, { focus: { ...focus, lexemes: ['lx_salam', 'lx_mersi', 'lx_ab'] } }),
        { levelId: 'u01-gen' },
      )
      const intros = s.challenges.filter((c) => c.isNew)
      expect(intros.map((c) => [c.type, c.ref.items[0]])).toEqual([
        ['select_translation', 'lx_salam'],
        ['select_translation', 'lx_mersi'],
        ['select_image', 'lx_ab'],
      ])
    })

    it('introduce nothing once every focus word has a card', () => {
      const s = gen(view, {
        levelId: 'u01-gen',
        learner: { ...fresh, lexemeCards: cards(focus.lexemes) },
      })
      expect(s.challenges.some((c) => c.isNew)).toBe(false)
      expect(s.challenges).toHaveLength(cfg.session.lengths.lesson!)
    })

    it('mix due reviews up to reviewShare, most overdue first', () => {
      const learned = ['lx_bad', 'lx_ruz', 'lx_to', 'lx_salam', 'lx_mersi']
      const learner = { ...fresh, lexemeCards: cards(learned, learned) }
      const s = gen(
        withSpec(fx, { focus: { ...focus, lexemes: ['lx_ab', 'lx_nun', 'lx_chay', 'lx_sib'] } }),
        { levelId: 'u01-gen', learner },
      )
      const reviewed = learned.filter((id) =>
        s.refs.some(
          (r) =>
            r.items.includes(id) ||
            r.items.some(
              (x) =>
                x.startsWith('s_') &&
                indexContent(fx)
                  .sentence(x)
                  .tokens.some((t) => t.lexeme === id),
            ),
        ),
      )
      expect(reviewed.length).toBeGreaterThanOrEqual(
        Math.min(
          learned.length,
          Math.floor(cfg.session.lengths.lesson! * cfg.session.reviewShare),
        ) - 1,
      )
      expect(
        s.refs.some(
          (r) =>
            r.items.includes('lx_bad') || r.items.includes('lx_ruz') || r.items.includes('lx_to'),
        ),
      ).toBe(true)
    })

    it('mix open mistakes in first', () => {
      const learner = { ...fresh, mistakes: ['chat:c_u01_001', 'sentence:s_u01_0004'] }
      const s = gen(view, { levelId: 'u01-gen', learner })
      expect(s.refs.some((r) => r.type === 'complete_chat' && r.items[0] === 'c_u01_001')).toBe(
        true,
      )
      expect(s.refs.some((r) => r.items[0] === 's_u01_0004')).toBe(true)
    })

    it('allow typing only from the second lesson of a level', () => {
      for (let i = 0; i < 20; i++) {
        const s = gen(view, { levelId: 'u01-gen', seed: `t${i}` })
        expect(s.challenges.some((c) => c.type === 'translate_type')).toBe(false)
      }
      const later = Array.from({ length: 20 }, (_, i) =>
        gen(view, {
          levelId: 'u01-gen',
          seed: `t${i}`,
          lessonIndex: 2,
          learner: { ...fresh, lexemeCards: cards(focus.lexemes) },
        }),
      )
      expect(later.some((s) => s.challenges.some((c) => c.type === 'translate_type'))).toBe(true)
    })

    it('keep pinned refs first, then generate the rest', () => {
      const s = gen(
        withSpec(fx, {
          focus,
          pinned: [{ type: 'complete_chat', items: ['c_u01_001'] }],
          length: 8,
        }),
        { levelId: 'u01-gen' },
      )
      expect(s.refs[0]).toEqual({ type: 'complete_chat', items: ['c_u01_001'] })
      expect(s.refs).toHaveLength(8)
      expect(s.refs.filter((r) => r.type === 'complete_chat')).toHaveLength(1)
    })

    it('build practice sessions from mistakes and weak words (no new words)', () => {
      const learner = {
        ...fresh,
        lexemeCards: cards(['lx_sib', 'lx_ab', 'lx_nun', 'lx_chay'], ['lx_sib']),
        mistakes: ['lexeme:lx_mersi'],
      }
      const s = gen(fx, { kind: 'practice', levelId: 'u01-p1', learner })
      expect(s.challenges).toHaveLength(cfg.session.lengths.practice!)
      expect(s.challenges.some((c) => c.isNew)).toBe(false)
      expect(
        s.refs.some(
          (r) =>
            r.items.includes('lx_mersi') ||
            r.items.some(
              (x) =>
                x.startsWith('s_') &&
                indexContent(fx)
                  .sentence(x)
                  .tokens.some((t) => t.lexeme === 'lx_mersi'),
            ),
        ),
      ).toBe(true)
    })

    it('draw unit reviews from the whole unit', () => {
      const s = gen(faEn.view('u01-hello'), { kind: 'unit_review', levelId: 'u01-review' })
      expect(s.challenges).toHaveLength(cfg.session.lengths.unit_review!)
      const sentences = new Set(s.refs.flatMap((r) => r.items.filter((x) => x.startsWith('s_'))))
      expect(sentences.size).toBeGreaterThan(4)
    })
  })

  describe('letters sessions', () => {
    it('introduce up to newWordsPerLesson letters, each with a sound check, then mix', () => {
      const s = gen(fx, { kind: 'letters', levelId: 'u01-letters-2' })
      expect(s.challenges).toHaveLength(cfg.session.lengths.letters!)
      const intros = s.challenges.filter((c) => c.type === 'letter_intro')
      expect(intros).toHaveLength(cfg.session.newWordsPerLesson)
      expect(intros.every((c) => c.isNew)).toBe(true)
      expect(s.challenges[0]!.type).toBe('letter_intro')
      expect(s.challenges[1]!.type).toBe('letter_sound')
      expect(new Set(s.challenges.map((c) => c.type)).size).toBeGreaterThanOrEqual(4)
    })

    it('review due letters from earlier lessons', () => {
      const first = ['l_alef', 'l_dal', 'l_re', 'l_ze', 'l_vav']
      const learner = { ...fresh, letterCards: cards(first, ['l_dal', 'l_re']) }
      const s = gen(fx, { kind: 'letters', levelId: 'u01-letters-2', learner })
      const reviewed = s.refs.filter(
        (r) => r.type === 'letter_sound' && ['l_dal', 'l_re'].includes(r.items[0]!),
      )
      expect(reviewed.length).toBeGreaterThanOrEqual(2)
    })

    it('pick the next lesson with unseen letters when no level is given', () => {
      const learner = { ...fresh, letterCards: cards(['l_alef', 'l_dal', 'l_re', 'l_ze', 'l_vav']) }
      const s = gen(fx, { kind: 'letters', levelId: null, learner })
      expect(s.challenges.filter((c) => c.isNew).map((c) => c.ref.items[0])).toEqual([
        'l_be',
        'l_mim',
        'l_nun',
      ])
    })

    it('practise the weakest letters once every letter is known', () => {
      const all = indexContent(fx).letterList.map((l) => l.id)
      const s = gen(fx, {
        kind: 'letters',
        levelId: null,
        learner: { ...fresh, letterCards: cards(all, ['l_ye']) },
      })
      expect(s.challenges.some((c) => c.isNew)).toBe(false)
      expect(s.challenges.length).toBeGreaterThan(0)
    })
  })

  it('allocate splits slots by weight with largest remainders', () => {
    expect(Object.fromEntries(allocate({ a: 1, b: 2, c: 1 }, 5))).toEqual({ a: 1, b: 3, c: 1 })
    expect(Object.fromEntries(allocate({ a: 1, b: 1, c: 0, d: -1 }, 3))).toEqual({ a: 2, b: 1 })
    expect([...allocate({ a: 1 }, 0).values()]).toEqual([])
    expect([...allocate({ a: 0.5, b: 0.5 }, 7).values()].reduce((x, y) => x + y)).toBe(7)
  })
})

// ------------------------------------------------------------------------------------ properties
interface Scenario {
  content: ContentView
  kind: SessionKind
  levelId: string | null
}
const fixtureScenarios: Scenario[] = [
  ...['u01-s0', 'u01-l1', 'u01-l2'].map((levelId) => ({
    content: fx,
    kind: 'lesson' as const,
    levelId,
  })),
  { content: fx, kind: 'practice', levelId: 'u01-p1' },
  { content: fx, kind: 'unit_review', levelId: 'u01-r1' },
  { content: fx, kind: 'letters', levelId: 'u01-letters-1' },
  { content: fx, kind: 'letters', levelId: 'u01-letters-2' },
  { content: fx, kind: 'jump_test', levelId: null },
  { content: withSpec(fx, { mix: 'intro' }), kind: 'lesson', levelId: 'u01-gen' },
  { content: withSpec(fx, { mix: 'standard' }), kind: 'legendary', levelId: 'u01-gen' },
]
const faEnScenarios: Scenario[] = faEn.units.flatMap((u) => {
  const content = faEn.view(u.id)
  return u.levels.flatMap((l): Scenario[] => {
    if (l.kind === 'lesson')
      return [
        { content, kind: 'lesson', levelId: l.id },
        { content, kind: 'legendary', levelId: l.id },
      ]
    if (l.kind === 'practice') return [{ content, kind: 'practice', levelId: l.id }]
    if (l.kind === 'unit_review') return [{ content, kind: 'unit_review', levelId: l.id }]
    return []
  })
})
const lettersView = faEn.view(null)
faEnScenarios.push(
  ...lettersView.letters.track.lessons.map((l) => ({
    content: lettersView,
    kind: 'letters' as const,
    levelId: l.id,
  })),
  { content: lettersView, kind: 'letters', levelId: null },
)

const learnerArb = (content: ContentView) => {
  const ix = indexContent(content)
  const lex = ix.lexemeList.map((l) => l.id)
  const letters = ix.letterList.map((l) => l.id)
  const items = [
    ...lex.map((id) => `lexeme:${id}`),
    ...ix.sentenceList.map((s) => `sentence:${s.id}`),
  ]
  return fc
    .record({
      learned: fc.subarray(lex),
      due: fc.subarray(lex),
      lettersLearned: fc.subarray(letters),
      lettersDue: fc.subarray(letters),
      mistakes: fc.subarray(items, { maxLength: 6 }),
    })
    .map((r): LearnerState => ({
      lexemeCards: cards(r.learned, r.due),
      letterCards: cards(r.lettersLearned, r.lettersDue),
      mistakes: r.mistakes,
      exposures: {},
    }))
}

const P2_TYPES: Readonly<Record<string, keyof SessionFeatures>> = {
  listen_type: 'persianTyping',
  cloze_type: 'persianTyping',
  letter_trace: 'letterTrace',
}

/** A type the session may contain: MVP types, and P2 types while their feature is on. */
function allowedType(c: Challenge, features: SessionFeatures | undefined): boolean {
  if (c.type === 'translate_type' && c.answerLang === 'fa') return features?.persianTyping === true
  const feature = P2_TYPES[c.type]
  if (feature) return features?.[feature] === true
  return (MVP_CHALLENGE_TYPES as readonly string[]).includes(c.type)
}

/** `withFeatures`: also draw the Wave 3 features and a practice mode (practice sessions). */
function checkScenario(scenarios: Scenario[], runs: number, withFeatures = false) {
  const scenario = fc.constantFrom(...scenarios).chain((sc) =>
    fc.record({
      sc: fc.constant(sc),
      seed: fc.string(),
      lessonIndex: fc.nat(4),
      learner: learnerArb(sc.content),
      features: withFeatures
        ? fc.record({ persianTyping: fc.boolean(), letterTrace: fc.boolean() })
        : fc.constant(undefined),
      practiceMode:
        withFeatures && sc.kind === 'practice'
          ? fc.constantFrom(...PracticeMode.options)
          : fc.constant(undefined),
    }),
  )
  fc.assert(
    fc.property(scenario, ({ sc, seed, lessonIndex, learner, features, practiceMode }) => {
      const input: GenerateInput = {
        content: sc.content,
        kind: sc.kind,
        levelId: sc.levelId,
        lessonIndex,
        learner,
        seed,
        now,
        config: cfg,
        ...(features ? { features } : {}),
        ...(practiceMode ? { practiceMode } : {}),
      }
      const a = generateSession(input)
      expect(a.refs.length).toBeGreaterThan(0)
      expect(a.challenges).toHaveLength(a.refs.length)
      a.challenges.forEach((c, i) => {
        const parsed = Challenge.safeParse(c)
        if (!parsed.success)
          throw new Error(`${sc.kind} ${sc.levelId} #${i} ${c.type}: ${parsed.error.message}`)
        expect(c.index).toBe(i)
        expect(c.ref).toEqual(a.refs[i])
        if (!allowedType(c, features))
          throw new Error(`${c.type} with features ${JSON.stringify(features)}`)
      })
      const level = sc.content.unit?.unit.levels.find((l) => l.id === sc.levelId)
      if (!level?.spec?.pinnedOnly) {
        const max = level?.spec?.length ?? cfg.session.lengths[sc.kind]!
        expect(a.refs.length).toBeLessThanOrEqual(max)
        expect(new Set(a.refs.map((r) => JSON.stringify(r))).size).toBe(a.refs.length) // no repeats
      }
      expect(generateSession(input)).toEqual(a) // deterministic
      expect(
        rebuildChallenges(JSON.parse(JSON.stringify(a.refs)) as ChallengeRef[], sc.content),
      ).toEqual(a.challenges)
    }),
    { numRuns: runs },
  )
}

describe('P2 builders (typed Persian, tracing)', () => {
  it('listen_type: the clip and transcript of listen_tap, a typed Persian key', () => {
    const r: ChallengeRef = { type: 'listen_type', items: ['s_u01_0005'] }
    const lt = of(buildChallenge(r, 3, fx), 'listen_type')
    const tap = of(
      buildChallenge({ type: 'listen_tap', items: ['s_u01_0005'] }, 3, fx),
      'listen_tap',
    )
    expect(lt.audio).toEqual(tap.audio)
    expect(lt.transcript).toEqual(tap.transcript)
    expect(accepts(lt.graph, 'چای می‌خوای', 'fa')).toBe(true)
    expect(accepts(lt.graph, 'چای میخوای؟', 'fa')).toBe(true)
    // Dictation: the orthography variant is what was said; the formal register is not.
    expect(accepts(lt.graph, 'چای می‌خای', 'fa')).toBe(true)
    expect(accepts(lt.graph, 'چای می‌خواهی؟', 'fa')).toBe(false)
    expect(accepts(lt.graph, 'نون می‌خوام', 'fa')).toBe(false)
    expect(Challenge.parse(lt)).toStrictEqual(lt)
    expect(buildChallenge(r, 3, fx)).toEqual(lt)
    // Words work too; an item without audio is not buildable (the planner skips it).
    expect(
      of(buildChallenge({ type: 'listen_type', items: ['lx_ab'] }, 0, fx), 'listen_type').transcript
        .fa,
    ).toBe('آب')
  })

  it('listen_type: no pronoun drop, no register swap; variants only when the view has them', () => {
    const r: ChallengeRef = { type: 'listen_type', items: ['s_u01_0007'] }
    const lt = of(buildChallenge(r, 0, fx), 'listen_type')
    expect(lt.transcript.fa).toBe('من سیب می‌خوام')
    expect(accepts(lt.graph, 'من سیب می‌خوام', 'fa')).toBe(true)
    expect(accepts(lt.graph, 'من سیب می‌خام', 'fa')).toBe(true)
    expect(accepts(lt.graph, 'سیب می‌خوام', 'fa')).toBe(false)
    expect(accepts(lt.graph, 'من سیب می‌خواهم', 'fa')).toBe(false)
    // Its translation key keeps the leniency a translation deserves.
    const tt = of(
      buildChallenge({ ...r, type: 'translate_type', direction: 'en_fa' }, 0, fx),
      'translate_type',
    )
    expect(accepts(tt.graph, 'سیب می‌خوام', 'fa')).toBe(true)
    // A view without variants (today's bundles) still builds, deterministically.
    const bare: ContentView = { ...fx, orthographyVariants: undefined }
    const plain = of(buildChallenge(r, 0, bare), 'listen_type')
    expect(accepts(plain.graph, 'من سیب می‌خام', 'fa')).toBe(false)
    expect(buildChallenge(r, 0, bare)).toEqual(plain)
    // …and the variant spelling is still a typo, not wrong.
    expect(gradeResponse(plain, { kind: 'text', value: 'من سیب می‌خام' }).verdict).toBe('typo')
  })

  it('cloze_type: whole-word tokens around the blank, a key for the blank only', () => {
    // Option 2 blanks token #1 (سیب) of «من سیب می‌خوام».
    const r: ChallengeRef = {
      type: 'cloze_type',
      items: ['s_u01_0007'],
      variant: encodeVariant({ option: 2 }),
    }
    const ct = of(buildChallenge(r, 0, fx), 'cloze_type')
    expect(ct.before.map((t) => t.surface)).toEqual(['من'])
    expect(ct.after.map((t) => t.surface)).toEqual(['می‌خوام'])
    expect(ct.translation).toMatch(/apple/)
    expect(accepts(ct.graph, 'سیب', 'fa')).toBe(true)
    expect(accepts(ct.graph, 'من سیب', 'fa')).toBe(false)
    expect(accepts(ct.graph, '', 'fa')).toBe(false)
    expect(accepts(ct.graph, 'نون', 'fa')).toBe(false)
    expect(Challenge.parse(ct)).toStrictEqual(ct)
    expect(buildChallenge(r, 0, fx)).toEqual(ct)
  })

  it('cloze_type: the blank accepts its register and orthography alternatives', () => {
    const verb = of(
      buildChallenge(
        { type: 'cloze_type', items: ['s_u01_0007'], variant: encodeVariant({ option: 3 }) },
        0,
        fx,
      ),
      'cloze_type',
    )
    expect(verb.after).toEqual([])
    for (const w of ['می‌خوام', 'میخوام', 'می‌خام', 'می‌خواهم'])
      expect(accepts(verb.graph, w, 'fa'), w).toBe(true)
    expect(accepts(verb.graph, 'می‌خوای', 'fa')).toBe(false)
    // Option 0: the engine picks a non-pronoun blank, deterministically.
    const picked = of(
      buildChallenge({ type: 'cloze_type', items: ['s_u01_0007'] }, 4, fx),
      'cloze_type',
    )
    expect(picked.before.map((t) => t.surface)).toContain('من')
    expect(buildChallenge({ type: 'cloze_type', items: ['s_u01_0007'] }, 4, fx)).toEqual(picked)
    // Blanking a pronoun-only position that isn't a candidate fails as content, never silently.
    expect(() =>
      buildChallenge(
        { type: 'cloze_type', items: ['s_u01_0007'], variant: encodeVariant({ option: 9 }) },
        0,
        fx,
      ),
    ).toThrow(ContentError)
  })

  it('letter_trace: the letter and the form its option names', () => {
    expect(TRACE_FORMS).toEqual(['isolated', 'initial', 'medial', 'final'])
    TRACE_FORMS.forEach((form, option) => {
      const r: ChallengeRef = {
        type: 'letter_trace',
        items: ['l_be'],
        ...(option ? { variant: encodeVariant({ option }) } : {}),
      }
      const lt = of(buildChallenge(r, 0, fx), 'letter_trace')
      expect(lt.form).toBe(form)
      expect(lt.letter).toMatchObject({ id: 'l_be', letter: 'ب', connects: true })
      expect(lt.letter.forms[form]).toBeTruthy()
      expect(Challenge.parse(lt)).toStrictEqual(lt)
    })
    // A non-connector (ر) has only isolated and final forms.
    expect(
      of(buildChallenge({ type: 'letter_trace', items: ['l_re'] }, 0, fx), 'letter_trace').form,
    ).toBe('isolated')
    expect(
      of(
        buildChallenge(
          { type: 'letter_trace', items: ['l_re'], variant: encodeVariant({ option: 3 }) },
          0,
          fx,
        ),
        'letter_trace',
      ).form,
    ).toBe('final')
    for (const option of [1, 2])
      expect(() =>
        buildChallenge(
          { type: 'letter_trace', items: ['l_re'], variant: encodeVariant({ option }) },
          0,
          fx,
        ),
      ).toThrow(ContentError)
    expect(() =>
      buildChallenge(
        { type: 'letter_trace', items: ['l_be'], variant: encodeVariant({ option: 4 }) },
        0,
        fx,
      ),
    ).toThrow(ContentError)
  })

  it('translate_type en→fa types the Persian sentence', () => {
    const tt = of(
      buildChallenge({ type: 'translate_type', items: ['s_u01_0003'], direction: 'en_fa' }, 0, fx),
      'translate_type',
    )
    expect(tt.answerLang).toBe('fa')
    expect(tt.prompt.lang).toBe('en')
    expect(accepts(tt.graph, 'نون می‌خوام', 'fa')).toBe(true)
  })
})

describe('Wave 3 seams (features, practiceMode)', () => {
  const on = { persianTyping: true, letterTrace: true }
  const learner = { ...fresh, lexemeCards: cards(indexContent(fx).lexemeList.map((l) => l.id)) }
  const sessions = [
    {
      content: withSpec(fx, { mix: 'standard' }),
      kind: 'lesson' as const,
      levelId: 'u01-gen',
      learner,
      lessonIndex: 1,
    },
    { content: fx, kind: 'practice' as const, levelId: null, learner, lessonIndex: 0 },
    {
      content: fx,
      kind: 'letters' as const,
      levelId: 'u01-letters-2',
      learner: fresh,
      lessonIndex: 0,
    },
  ]
  const SEEDS = Array.from({ length: 12 }, (_, i) => `w3-${i}`)
  const typedPersian = (r: ChallengeRef) =>
    r.type === 'listen_type' ||
    r.type === 'cloze_type' ||
    (r.type === 'translate_type' && r.direction === 'en_fa')

  it('with the features on, sessions are valid, within length and rebuild exactly', () => {
    for (const s of sessions)
      for (const seed of SEEDS.slice(0, 3)) {
        const out = gen(s.content, { ...s, seed, features: on })
        expect(out.challenges.length).toBeGreaterThan(0)
        for (const c of out.challenges) {
          expect(Challenge.safeParse(c).success).toBe(true)
          expect(allowedType(c, on)).toBe(true)
        }
        expect(out.refs.length).toBeLessThanOrEqual(cfg.session.lengths[s.kind]!)
        expect(rebuildChallenges(out.refs, s.content)).toEqual(out.challenges)
      }
  })

  it('features absent and features off build the same session', () => {
    for (const s of sessions) {
      const off = gen(s.content, { ...s, features: { persianTyping: false, letterTrace: false } })
      expect(gen(s.content, s)).toEqual(off)
    }
  })

  it("the typing pool appears only with persianTyping (and not in a level's first lesson)", () => {
    const [lesson, practice] = sessions
    const refsOf = (
      s: (typeof sessions)[number],
      features?: SessionFeatures,
      over: Partial<GenerateInput> = {},
    ) =>
      SEEDS.flatMap(
        (seed) => gen(s!.content, { ...s, seed, ...(features ? { features } : {}), ...over }).refs,
      )
    for (const s of [lesson!, practice!]) {
      expect(refsOf(s).some(typedPersian)).toBe(false)
      expect(refsOf(s, { letterTrace: true }).some(typedPersian)).toBe(false)
      const typing = refsOf(s, { persianTyping: true })
      expect(typing.some(typedPersian)).toBe(true)
      expect(typing.some((r) => r.type === 'letter_trace')).toBe(false)
    }
    expect(refsOf(lesson!, { persianTyping: true }, { lessonIndex: 0 }).some(typedPersian)).toBe(
      false,
    )
  })

  it('the letterTrace pool appears only with letterTrace, isolated and joined forms', () => {
    // A learner who knows the letters: no intros, so the mix has room for every category.
    const known = { ...fresh, letterCards: cards(indexContent(fx).letterList.map((l) => l.id)) }
    const letters = { ...sessions[2]!, learner: known }
    const traces = (features?: SessionFeatures) =>
      SEEDS.flatMap(
        (seed) =>
          gen(letters.content, { ...letters, seed, ...(features ? { features } : {}) }).challenges,
      ).filter((c): c is ChallengeOf<'letter_trace'> => c.type === 'letter_trace')
    expect(traces()).toEqual([])
    expect(traces({ persianTyping: true })).toEqual([])
    const on = traces({ letterTrace: true })
    expect(on.length).toBeGreaterThan(0)
    expect(new Set(on.map((c) => c.form)).has('isolated')).toBe(true)
    expect(on.some((c) => c.form !== 'isolated')).toBe(true)
    for (const c of on) if (!c.letter.connects) expect(['isolated', 'final']).toContain(c.form)
  })

  it('ladder step 5: a new word is typed in Persian, only with persianTyping', () => {
    const view = withSpec(fx, {
      mix: 'standard',
      focus: { lexemes: ['lx_nun', 'lx_chay'], sentences: [], letters: [], chats: [] },
    })
    const base = { levelId: 'u01-gen', lessonIndex: 1, learner: fresh }
    for (const seed of SEEDS.slice(0, 4)) {
      const off = gen(view, { ...base, seed })
      const onS = gen(view, { ...base, seed, features: { persianTyping: true } })
      const typed = (refs: ChallengeRef[]) =>
        refs
          .filter((r) => r.type === 'translate_type' && r.direction === 'en_fa')
          .flatMap((r) => r.items)
      expect(typed(off.refs)).toEqual([])
      const newWords = onS.challenges.filter((c) => c.isNew).map((c) => c.ref.items[0]!)
      expect(newWords.length).toBeGreaterThan(0)
      const ix = indexContent(view)
      for (const w of newWords) {
        const covers = typed(onS.refs).some(
          (id) =>
            id === w || (id.startsWith('s_') && ix.sentence(id).tokens.some((t) => t.lexeme === w)),
        )
        expect(covers, `${seed}: ${w}`).toBe(true)
      }
    }
    // A level's first lesson keeps the MVP ladder.
    const first = gen(view, { ...base, lessonIndex: 0, features: { persianTyping: true } })
    expect(first).toEqual(gen(view, { ...base, lessonIndex: 0 }))
  })

  describe('practice modes', () => {
    const practice = sessions[1]!
    const withMistakes = { ...learner, mistakes: ['sentence:s_u01_0005', 'lexeme:lx_sib'] }
    const practiceGen = (over: Partial<GenerateInput>) =>
      gen(practice.content, { ...practice, ...over })

    it("mixed is today's practice session, byte-identical", () => {
      for (const seed of SEEDS.slice(0, 4))
        for (const l of [learner, withMistakes])
          for (const features of [undefined, on])
            expect(
              practiceGen({
                seed,
                learner: l,
                practiceMode: 'mixed',
                ...(features ? { features } : {}),
              }),
            ).toEqual(practiceGen({ seed, learner: l, ...(features ? { features } : {}) }))
    })

    it('mistakes starts with the open mistakes; with none it is the mixed session', () => {
      const ix = indexContent(fx)
      const aboutMistake = (r: ChallengeRef) => {
        const id = r.items[0]!
        return (
          id === 's_u01_0005' ||
          id === 'lx_sib' ||
          (id.startsWith('s_') && ix.sentence(id).tokens.some((t) => t.lexeme === 'lx_sib'))
        )
      }
      for (const seed of SEEDS.slice(0, 4)) {
        const out = practiceGen({ seed, learner: withMistakes, practiceMode: 'mistakes' })
        expect(out.refs).toHaveLength(cfg.session.lengths.practice!)
        expect(aboutMistake(out.refs[0]!)).toBe(true)
        expect(aboutMistake(out.refs[1]!)).toBe(true)
        expect(new Set(out.refs.map((r) => JSON.stringify(r))).size).toBe(out.refs.length)
        expect(rebuildChallenges(out.refs, fx)).toEqual(out.challenges)
        expect(practiceGen({ seed, learner: withMistakes, practiceMode: 'mistakes' })).toEqual(out)
        expect(practiceGen({ seed, practiceMode: 'mistakes' })).toEqual(practiceGen({ seed }))
      }
    })

    it('a one-mistake drill is topped up to the normal practice length, mistake first', () => {
      for (const mistakes of [['chat:c_u01_001'], ['sentence:s_u01_0005']]) {
        const item = mistakes[0]!.slice(mistakes[0]!.indexOf(':') + 1)
        for (const seed of SEEDS.slice(0, 4)) {
          const out = practiceGen({
            seed,
            learner: { ...learner, mistakes },
            practiceMode: 'mistakes',
          })
          expect(out.refs).toHaveLength(cfg.session.lengths.practice!)
          expect(out.refs[0]!.items).toEqual([item])
          // The drill (≤ 4 exercises of a sentence, 1 of a chat) leads; the mixed plan follows.
          const drill = out.refs.findIndex((r) => r.items[0] !== item)
          expect(drill).toBeGreaterThan(0)
          expect(drill).toBeLessThanOrEqual(4)
          expect(rebuildChallenges(out.refs, fx)).toEqual(out.challenges)
        }
      }
    })

    it('listening keeps to listening challenges (listen_type with persianTyping)', () => {
      for (const seed of SEEDS.slice(0, 3)) {
        const off = practiceGen({ seed, practiceMode: 'listening' })
        expect(new Set(off.refs.map((r) => r.type))).toEqual(new Set(['listen_tap']))
        expect(off.refs.length).toBe(cfg.session.lengths.practice)
        const typing = practiceGen({
          seed,
          practiceMode: 'listening',
          features: { persianTyping: true },
        })
        expect(new Set(typing.refs.map((r) => r.type))).toEqual(
          new Set(['listen_tap', 'listen_type']),
        )
      }
    })

    it('typing keeps to typed answers (Persian ones with persianTyping)', () => {
      for (const seed of SEEDS.slice(0, 3)) {
        const off = practiceGen({ seed, practiceMode: 'typing' })
        expect(off.refs.every((r) => r.type === 'translate_type' && r.direction === 'fa_en')).toBe(
          true,
        )
        expect(off.refs.length).toBeGreaterThan(0)
        const typing = practiceGen({
          seed,
          practiceMode: 'typing',
          features: { persianTyping: true },
        })
        expect(typing.refs.every((r) => r.type === 'translate_type' || typedPersian(r))).toBe(true)
        expect(typing.refs.some(typedPersian)).toBe(true)
        expect(rebuildChallenges(typing.refs, fx)).toEqual(typing.challenges)
      }
    })

    it('modes only apply to practice sessions', () => {
      const lesson = sessions[0]!
      expect(gen(lesson.content, { ...lesson, practiceMode: 'listening' })).toEqual(
        gen(lesson.content, lesson),
      )
    })
  })
})

// Each property run generates, regenerates and rebuilds a whole session with the real grader
// (tens of ms), so 150 runs need more than Vitest's 5 s default.
const PROPERTY_TIMEOUT_MS = 60_000

describe('properties', () => {
  it(
    'fixture course: schema-valid, deterministic and rebuildable for any seed and learner',
    () => {
      checkScenario(fixtureScenarios, 150)
    },
    PROPERTY_TIMEOUT_MS,
  )

  it(
    'content/fa-en: schema-valid, deterministic and rebuildable for any seed and learner',
    () => {
      checkScenario(faEnScenarios, 150)
    },
    PROPERTY_TIMEOUT_MS,
  )

  it(
    'fixture course with Wave 3 features and practice modes: valid, deterministic, rebuildable',
    () => {
      checkScenario(
        [...fixtureScenarios, { content: fx, kind: 'lesson', levelId: 'u01-t1' }],
        150,
        true,
      )
    },
    PROPERTY_TIMEOUT_MS,
  )

  it(
    'content/fa-en with Wave 3 features and practice modes: valid, deterministic, rebuildable',
    () => {
      checkScenario(faEnScenarios, 150, true)
    },
    PROPERTY_TIMEOUT_MS,
  )

  it('different seeds give different generated sessions', () => {
    const view = withSpec(fx, { mix: 'standard' })
    const learner = { ...fresh, lexemeCards: cards(indexContent(fx).lexemeList.map((l) => l.id)) }
    const sessions = new Set(
      Array.from({ length: 10 }, (_, i) =>
        JSON.stringify(gen(view, { levelId: 'u01-gen', seed: `s${i}`, learner }).refs),
      ),
    )
    expect(sessions.size).toBeGreaterThan(5)
  })
})

describe('complete_chat speakers', () => {
  const chatOnly = (view: ContentView) =>
    gen(
      withSpec(view, {
        pinned: [{ type: 'complete_chat', items: ['c_u01_001'] }],
        pinnedOnly: true,
      }),
      {
        levelId: 'u01-gen',
      },
    ).challenges[0]!

  it('carry the character portrait as a media URL when the course has one', () => {
    const view = faEn.view('u01-hello')
    const portrait = '/media/fa-en/characters/shirin/portrait.webp'
    expect(indexContent(view).characterImage('shirin')).toBe(portrait)
    expect(indexContent(view).characterImage('nobody')).toBeUndefined()
    const cc = of(chatOnly(view), 'complete_chat')
    expect(cc.speaker).toStrictEqual({ id: 'shirin', name: 'Shirin', image: portrait })
    expect(Challenge.parse(cc)).toStrictEqual(cc)
  })

  it('leave the portrait out when the character has none (the placeholder is drawn)', () => {
    const cc = of(chatOnly(fx), 'complete_chat')
    expect(cc.speaker).toStrictEqual({ id: 'leila', name: 'Leila' })
  })
})

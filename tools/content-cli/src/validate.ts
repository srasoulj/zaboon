/**
 * Course validation (docs/LEARNING-ENGINE.md §4.3). Wave 0 covers structure, references,
 * statuses, media presence and answer patterns; ws-content-cli extends it (distractor safety,
 * media sign-off, normalization lint).
 */
import { accepts, canonical, compile, type Lang } from '@zaboon/grader'
import { normalize } from '@zaboon/farsi'
import {
  patternList,
  type AnswerGraph,
  type ChallengeType,
  type Sentence,
} from '@zaboon/content-schema'
import type { ContentIssue, LoadedCourse } from './load'

export type ItemKind = 'lexeme' | 'sentence' | 'letter' | 'chat'

export function kindOf(id: string): ItemKind | null {
  if (id.startsWith('lx_')) return 'lexeme'
  if (id.startsWith('s_')) return 'sentence'
  if (id.startsWith('l_')) return 'letter'
  if (id.startsWith('c_')) return 'chat'
  return null
}

interface ItemRule {
  kinds: readonly ItemKind[]
  min: number
  max: number
  needsDirection?: boolean
  needsImage?: boolean
  needsAudio?: boolean
}

/** What each challenge type expects in a pinned spec's `items`. */
export const ITEM_RULES: Record<ChallengeType, ItemRule> = {
  select_image: { kinds: ['lexeme'], min: 1, max: 1, needsImage: true },
  select_translation: { kinds: ['lexeme', 'sentence'], min: 1, max: 1 },
  translate_bank: { kinds: ['sentence'], min: 1, max: 1, needsDirection: true },
  translate_type: { kinds: ['sentence'], min: 1, max: 1, needsDirection: true },
  match_pairs: { kinds: ['lexeme'], min: 2, max: 5 },
  listen_tap: { kinds: ['sentence'], min: 1, max: 1, needsAudio: true },
  cloze_choice: { kinds: ['sentence'], min: 1, max: 1 },
  complete_chat: { kinds: ['chat'], min: 1, max: 1 },
  letter_intro: { kinds: ['letter'], min: 1, max: 1 },
  letter_sound: { kinds: ['letter'], min: 1, max: 1, needsAudio: true },
  letter_forms: { kinds: ['letter'], min: 1, max: 5 },
  read_word: { kinds: ['lexeme'], min: 1, max: 1 },
  build_word: { kinds: ['lexeme'], min: 1, max: 1 },
  listen_type: { kinds: ['sentence'], min: 1, max: 1, needsAudio: true },
  cloze_type: { kinds: ['sentence'], min: 1, max: 1 },
  letter_trace: { kinds: ['letter'], min: 1, max: 1 },
  speak: { kinds: ['sentence'], min: 1, max: 1 },
  story: { kinds: ['lexeme', 'sentence', 'letter', 'chat'], min: 1, max: 50 },
}

/** Compiles a sentence's accepted answers (§3). Throws on malformed patterns. */
export function compileSentence(
  s: Sentence,
  variants: readonly (readonly string[])[],
): { en: AnswerGraph; fa: AnswerGraph } {
  const en = compile(patternList(s.en), { lang: 'en' })
  const faPatterns = s.faAccept === undefined ? [s.fa] : patternList(s.faAccept)
  const fa = compile(faPatterns, {
    lang: 'fa',
    ...(s.faFormal === undefined ? {} : { formal: s.faFormal }),
    pronounDrop: s.pronounDrop ?? true,
    variants,
  })
  return { en, fa }
}

/** Every media ref an item points at, with a label for messages. */
export function mediaRefs(
  course: LoadedCourse,
): { ref: string; owner: string; status: 'draft' | 'approved' }[] {
  const out: { ref: string; owner: string; status: 'draft' | 'approved' }[] = []
  const add = (ref: string | undefined, owner: string, status: 'draft' | 'approved') => {
    if (ref) out.push({ ref, owner, status })
  }
  for (const l of course.lexemes) {
    add(l.audio, `lexeme ${l.id}`, l.status)
    add(l.image, `lexeme ${l.id}`, l.status)
  }
  for (const s of course.sentences) {
    add(s.audio?.normal, `sentence ${s.id}`, s.status)
    add(s.audio?.slow, `sentence ${s.id}`, s.status)
    add(s.audio?.envelope, `sentence ${s.id}`, s.status)
    add(s.audio?.formal, `sentence ${s.id}`, s.status)
  }
  for (const l of course.letters?.letters ?? []) add(l.audio, `letter ${l.id}`, l.status)
  for (const c of course.characters) {
    add(c.image, `character ${c.id}`, c.status)
    add(c.rive, `character ${c.id}`, c.status)
  }
  return out
}

export interface ValidateOptions {
  /** Allow `status: draft` items (dev/staging builds only). */
  allowDrafts: boolean
}

export function validateCourse(course: LoadedCourse, opts: ValidateOptions): ContentIssue[] {
  const issues: ContentIssue[] = [...course.issues]
  const src = (kind: string, id: string) => course.sources.get(`${kind}:${id}`) ?? '?'
  const err = (file: string, message: string) => issues.push({ severity: 'error', file, message })
  const warn = (file: string, message: string) =>
    issues.push({ severity: 'warning', file, message })

  const lexemes = new Map(course.lexemes.map((l) => [l.id, l]))
  const sentences = new Map(course.sentences.map((s) => [s.id, s]))
  const chats = new Map(course.chats.map((c) => [c.id, c]))
  const letters = new Map((course.letters?.letters ?? []).map((l) => [l.id, l]))
  const characters = new Map(course.characters.map((c) => [c.id, c]))
  const units = new Map(course.units.map((u) => [u.id, u]))
  const exists = (id: string): boolean => {
    switch (kindOf(id)) {
      case 'lexeme':
        return lexemes.has(id)
      case 'sentence':
        return sentences.has(id)
      case 'letter':
        return letters.has(id)
      case 'chat':
        return chats.has(id)
      default:
        return false
    }
  }

  // --- course sections ↔ unit files ---------------------------------------------------------
  const order = new Map<string, number>()
  if (course.course) {
    for (const section of course.course.sections) {
      for (const unitId of section.units) {
        if (order.has(unitId)) err('course.yaml', `unit ${unitId} is listed twice`)
        order.set(unitId, order.size)
        if (!units.has(unitId))
          err('course.yaml', `section ${section.id} lists unknown unit ${unitId}`)
      }
    }
    for (const u of course.units) {
      if (!order.has(u.id))
        err(src('unit', u.id), `unit ${u.id} is not listed in any course section`)
    }
  }

  // --- units, levels, lesson specs ------------------------------------------------------------
  const levelIds = new Map<string, string>()
  for (const u of course.units) {
    const file = src('unit', u.id)
    if (u.guidebook && !course.guidebooks.has(u.guidebook))
      err(file, `guidebook not found: ${u.guidebook}`)
    for (const c of u.characters) if (!characters.has(c)) err(file, `unknown character ${c}`)
    for (const level of u.levels) {
      if (levelIds.has(level.id))
        err(file, `duplicate level id ${level.id} (also in ${levelIds.get(level.id)})`)
      levelIds.set(level.id, file)
      if (level.kind === 'lesson' && !level.spec) {
        // Placeholder units keep spec-less lessons until content is drafted: fine for dev builds.
        const message = `lesson level ${level.id} has no spec (not playable)`
        if (opts.allowDrafts) warn(file, message)
        else err(file, message)
      }
      const spec = level.spec
      if (!spec) continue
      const where = `level ${level.id}`
      for (const [field, ids] of Object.entries(spec.focus)) {
        for (const id of ids)
          if (!exists(id)) err(file, `${where}: focus.${field} references unknown item ${id}`)
      }
      if (spec.pinnedOnly && spec.pinned.length === 0)
        err(file, `${where}: pinnedOnly with no pinned challenges`)
      spec.pinned.forEach((p, i) => {
        const at = `${where} pinned[${i}] (${p.type})`
        const rule = ITEM_RULES[p.type]
        if (p.items.length < rule.min || p.items.length > rule.max) {
          err(
            file,
            `${at}: expects ${rule.min === rule.max ? rule.min : `${rule.min}–${rule.max}`} item(s), got ${p.items.length}`,
          )
        }
        if (rule.needsDirection && !p.direction)
          err(file, `${at}: needs a direction (fa_en or en_fa)`)
        for (const id of [...p.items, ...(p.distractors ?? [])]) {
          const kind = kindOf(id)
          if (!kind || !rule.kinds.includes(kind))
            err(file, `${at}: ${id} is not a ${rule.kinds.join('/')}`)
          else if (!exists(id)) err(file, `${at}: unknown item ${id}`)
        }
        if (rule.needsImage) {
          for (const id of [...p.items, ...(p.distractors ?? [])]) {
            const lx = lexemes.get(id)
            if (lx && !lx.image) err(file, `${at}: lexeme ${id} has no image`)
          }
          if ((p.distractors ?? []).length < 1) err(file, `${at}: select_image needs distractors`)
        }
        if (rule.needsAudio) {
          for (const id of p.items) {
            const hasAudio =
              sentences.get(id)?.audio?.normal ?? letters.get(id)?.audio ?? lexemes.get(id)?.audio
            if (exists(id) && !hasAudio) err(file, `${at}: ${id} has no audio`)
          }
        }
      })
    }
  }

  // --- lexemes --------------------------------------------------------------------------------
  for (const l of course.lexemes) {
    if (!units.has(l.introducedIn))
      err(src('lexeme', l.id), `lexeme ${l.id}: introducedIn unknown unit ${l.introducedIn}`)
  }

  // --- sentences: tokens, units, answer patterns ------------------------------------------------
  for (const s of course.sentences) {
    const file = src('sentence', s.id)
    const where = `sentence ${s.id}`
    if (!units.has(s.unit)) err(file, `${where}: unknown unit ${s.unit}`)
    for (const t of s.tokens) {
      if (!t.lexeme) continue
      const lx = lexemes.get(t.lexeme)
      if (!lx) {
        err(file, `${where}: token ${t.surface} references unknown lexeme ${t.lexeme}`)
        continue
      }
      const introduced = order.get(lx.introducedIn)
      const used = order.get(s.unit)
      if (introduced !== undefined && used !== undefined && introduced > used) {
        err(file, `${where}: lexeme ${lx.id} is introduced in ${lx.introducedIn}, after ${s.unit}`)
      }
    }
    const tokenText = s.tokens.map((t) => t.surface).join(' ')
    if (normalize(tokenText) !== normalize(s.fa))
      err(file, `${where}: tokens "${tokenText}" do not spell fa "${s.fa}"`)
    if (s.audio?.speaker && !characters.has(s.audio.speaker))
      err(file, `${where}: unknown audio speaker ${s.audio.speaker}`)
    let graphs: { en: AnswerGraph; fa: AnswerGraph }
    try {
      graphs = compileSentence(s, course.variants)
    } catch (e) {
      err(file, `${where}: pattern does not compile: ${(e as Error).message}`)
      continue
    }
    const mustAccept: [Lang, string, string][] = [
      ['fa', s.fa, 'fa'],
      ['fa', tokenText, 'its token sequence'],
      ...(s.faFormal ? ([['fa', s.faFormal, 'faFormal']] as [Lang, string, string][]) : []),
    ]
    for (const [lang, text, label] of mustAccept) {
      if (!accepts(graphs[lang], text, lang))
        err(file, `${where}: accepted answers do not include ${label} "${text}"`)
    }
    if (!canonical(graphs.en)) err(file, `${where}: English patterns produce no answer`)
  }

  // --- chats ----------------------------------------------------------------------------------
  for (const c of course.chats) {
    const file = src('chat', c.id)
    if (!characters.has(c.speaker)) err(file, `chat ${c.id}: unknown speaker ${c.speaker}`)
    for (const id of [c.prompt, ...c.options])
      if (!sentences.has(id)) err(file, `chat ${c.id}: unknown sentence ${id}`)
    if (c.answer >= c.options.length) err(file, `chat ${c.id}: answer ${c.answer} is out of range`)
    if (new Set(c.options).size !== c.options.length) err(file, `chat ${c.id}: duplicate options`)
  }

  // --- letters track --------------------------------------------------------------------------
  if (!course.letters && !course.issues.some((i) => i.file === 'letters.yaml'))
    err('letters.yaml', 'missing letters.yaml')
  if (course.letters) {
    const seen = new Set<string>()
    for (const l of course.letters.letters) {
      for (const ex of l.examples)
        if (!lexemes.has(ex)) err('letters.yaml', `letter ${l.id}: unknown example ${ex}`)
    }
    for (const lesson of course.letters.lessons) {
      if (levelIds.has(lesson.id) || seen.has(lesson.id))
        err('letters.yaml', `duplicate level id ${lesson.id}`)
      seen.add(lesson.id)
      for (const id of lesson.letters)
        if (!letters.has(id)) err('letters.yaml', `lesson ${lesson.id}: unknown letter ${id}`)
    }
  }

  // --- media ----------------------------------------------------------------------------------
  for (const m of mediaRefs(course)) {
    if (course.assets.has(m.ref)) continue
    const message = `${m.owner}: media not found: assets/${m.ref}`
    if (m.status === 'draft' && opts.allowDrafts)
      warn('assets', `${message} (draft; omitted from builds)`)
    else err('assets', message)
  }

  // --- statuses -------------------------------------------------------------------------------
  const drafts: string[] = []
  const collect = (kind: string, items: { id: string; status: string }[]) => {
    for (const it of items) if (it.status === 'draft') drafts.push(`${kind}:${it.id}`)
  }
  collect('unit', course.units)
  collect('lexeme', course.lexemes)
  collect('sentence', course.sentences)
  collect('chat', course.chats)
  collect('letter', course.letters?.letters ?? [])
  collect('character', course.characters)
  if (drafts.length > 0 && !opts.allowDrafts) {
    for (const d of drafts) {
      const [kind, id] = d.split(':') as [string, string]
      err(src(kind, id), `${kind} ${id} is a draft; only approved items can be published`)
    }
  }

  return issues
}

export function hasErrors(issues: readonly ContentIssue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}

export function formatIssues(issues: readonly ContentIssue[]): string {
  return issues
    .map((i) => `${i.severity === 'error' ? '✘' : '!'} ${i.file}: ${i.message}`)
    .join('\n')
}

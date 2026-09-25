/**
 * `draft` (LEARNING-ENGINE §4.1): drafts a unit's lexemes, sentences, chats, lesson levels and
 * guidebook from a unit brief with the pinned text model, in exactly the authoring layout and
 * house style of content/fa-en (STYLE.md). The output is zod-validated structured JSON, turned
 * into `status: draft` YAML with provenance (model + prompt version), and checked with the same
 * validator as `validate --allow-drafts` before anything is written. If validation finds new
 * problems, the model gets one repair round with the exact messages.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { aiProvenance, MODELS, promptId, type AiClient, type ChatMessage } from '@zaboon/ai'
import {
  CharacterId,
  LexemeId,
  PartOfSpeech,
  UnitId,
  type Chat,
  type Level,
  type Lexeme,
  type Provenance,
  type Sentence,
  type Unit,
} from '@zaboon/content-schema'
import { canonical } from '@zaboon/grader'
import type { DryRunCall } from './ai-context'
import { fixPersianText } from './lint'
import type { ContentIssue, LoadedCourse } from './load'
import { DRAFT_UNIT, renderSystem } from './prompts'
import { compileSentence, validateCourse } from './validate'
import { docToYaml, listToYaml } from './yaml-out'

// ---------------------------------------------------------------------------------------------
// Brief (input) and model output schemas
// ---------------------------------------------------------------------------------------------

/** A unit brief (YAML file passed to `draft --brief`). */
export const UnitBrief = z.object({
  unit: UnitId,
  theme: z.string().min(1),
  /** Grammar points to teach, in order. */
  grammar: z.array(z.string().min(1)).default([]),
  vocabulary: z
    .object({
      /** Known lexemes the unit may use. Default: everything introduced before this unit. */
      existing: z.array(LexemeId).optional(),
      /** New words to introduce (English hints; the model writes the Persian). */
      new: z.array(z.string().min(1)).default([]),
    })
    .default({ new: [] }),
  /** Cast members who speak in this unit. Default: the unit's `characters`. */
  characters: z.array(CharacterId).optional(),
  levels: z.number().int().min(1).max(6).default(3),
  sentencesPerLevel: z.number().int().min(2).max(15).default(8),
  chatsPerLevel: z.number().int().min(0).max(4).default(1),
  /** Unit whose files are shown as the style exemplar. Default: u01-hello (the seed unit). */
  exemplar: UnitId.optional(),
  notes: z.string().optional(),
})
export type UnitBrief = z.infer<typeof UnitBrief>

const Fa = z.string().min(1)
const DraftLexeme = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/),
  fa: Fa,
  faFormal: Fa.nullable(),
  faVocalized: Fa.nullable(),
  translit: z.string().min(1),
  translitFormal: z.string().min(1).nullable(),
  pos: PartOfSpeech,
  glosses: z.array(z.string().min(1)).min(1),
  forms: z.array(z.object({ key: z.string().min(1), value: Fa })),
  tags: z.array(z.string().min(1)),
})
const DraftSentence = z.object({
  ref: z.string().min(1),
  fa: Fa,
  faFormal: Fa.nullable(),
  faVocalized: Fa.nullable(),
  translit: z.string().min(1),
  translitFormal: z.string().min(1).nullable(),
  tokens: z
    .array(
      z.object({
        surface: Fa,
        lexeme: z.string().min(1),
        translit: z.string().min(1),
        gloss: z.string().min(1),
      }),
    )
    .min(1),
  en: z.array(z.string().min(1)).min(1),
  faAccept: z.array(z.string().min(1)),
  speaker: z.string().nullable(),
  tags: z.array(z.string().min(1)),
})
const DraftChat = z.object({
  speaker: z.string().min(1),
  prompt: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(4),
  answer: z.number().int().nonnegative(),
})
export const DraftOutput = z.object({
  lexemes: z.array(DraftLexeme),
  sentences: z.array(DraftSentence).min(1),
  chats: z.array(DraftChat),
  levels: z
    .array(
      z.object({
        title: z.string().min(1),
        lexemes: z.array(z.string().min(1)),
        sentences: z.array(z.string().min(1)).min(1),
        chats: z.array(z.number().int().nonnegative()),
      }),
    )
    .min(1),
  guidebook: z.string().min(1),
})
export type DraftOutput = z.infer<typeof DraftOutput>

// ---------------------------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------------------------

export interface DraftPlan {
  unit: Unit
  brief: UnitBrief
  /** Lexemes the unit may use besides its new ones. */
  vocabulary: Lexeme[]
  exemplar: string | null
  messages: ChatMessage[]
  maxTokens: number
}

const unitPrefix = (unitId: string) => unitId.slice(0, 3)

function readIf(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

export function loadBrief(file: string): UnitBrief {
  const raw = parseYaml(readFileSync(file, 'utf8')) as unknown
  const parsed = UnitBrief.safeParse(raw)
  if (!parsed.success)
    throw new Error(
      `invalid brief ${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    )
  return parsed.data
}

/** The files of one unit, as the model's style exemplar. */
export function exemplarText(course: LoadedCourse, unitId: string): string | null {
  const unit = course.units.find((u) => u.id === unitId)
  if (!unit) return null
  const parts: string[] = []
  for (const rel of [
    `units/${unitId}.yaml`,
    `lexemes/${unitId}.yaml`,
    `sentences/${unitId}.yaml`,
    `chats/${unitId}.yaml`,
    unit.guidebook ?? `guidebooks/${unitId}.md`,
  ]) {
    const text = readIf(join(course.dir, rel))
    if (text) parts.push(`## ${rel}\n\n${text.trim()}`)
  }
  return parts.length ? parts.join('\n\n') : null
}

function modelAnswer(s: Sentence, course: LoadedCourse): string {
  try {
    return canonical(compileSentence(s, course.variants).en)
  } catch {
    return '?'
  }
}

export function planDraft(course: LoadedCourse, brief: UnitBrief): DraftPlan {
  const unit = course.units.find((u) => u.id === brief.unit)
  if (!unit)
    throw new Error(
      `unit ${brief.unit} does not exist: add it to course.yaml and units/${brief.unit}.yaml first`,
    )
  if (unit.status === 'approved')
    throw new Error(`unit ${unit.id} is approved; redrafting it would replace reviewed content`)
  const order = course.course?.sections.flatMap((s) => s.units) ?? course.units.map((u) => u.id)
  const at = order.indexOf(unit.id)
  const earlier = new Set(order.slice(0, Math.max(at, 0)))
  const vocabulary = brief.vocabulary.existing
    ? brief.vocabulary.existing.map((id) => {
        const lx = course.lexemes.find((l) => l.id === id)
        if (!lx) throw new Error(`brief: unknown lexeme ${id}`)
        return lx
      })
    : course.lexemes.filter((l) => earlier.has(l.introducedIn))
  const castIds = brief.characters ?? unit.characters
  const cast = course.characters.filter((c) => castIds.includes(c.id))
  const exemplarId =
    brief.exemplar ??
    (course.units.some((u) => u.id === 'u01-hello' && u.id !== unit.id)
      ? 'u01-hello'
      : course.units.find((u) => u.id !== unit.id && course.sentences.some((s) => s.unit === u.id))
          ?.id)
  const exemplar = exemplarId && exemplarId !== unit.id ? exemplarText(course, exemplarId) : null
  const style = readIf(join(course.dir, 'STYLE.md')) ?? '(no STYLE.md in this course)'

  const briefText = [
    `Unit: ${unit.id} "${unit.title}"${unit.subtitle ? ` (${unit.subtitle})` : ''}, register: ${unit.register}`,
    `Theme: ${brief.theme}`,
    brief.grammar.length ? `Target grammar:\n${brief.grammar.map((g) => `- ${g}`).join('\n')}` : '',
    brief.vocabulary.new.length
      ? `New words to introduce (define each as a new lexeme):\n${brief.vocabulary.new.map((w) => `- ${w}`).join('\n')}`
      : 'Introduce only the new lexemes the theme needs (about 6–10 per lesson level).',
    `Speakers: ${cast.map((c) => c.id).join(', ') || '(any cast member)'}`,
    `Size: ${brief.levels} lesson level(s), about ${brief.sentencesPerLevel} sentences and ${brief.chatsPerLevel} chat(s) per level. Each level introduces new items and may reuse anything from earlier levels and units.`,
    `IDs: define new lexemes with a lowercase \`key\` (becomes lx_<key>); give sentences refs s1, s2, …; chats may also use earlier sentence ids from the course context.`,
    brief.notes ? `Notes: ${brief.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const earlierSentences = course.sentences.filter((s) => earlier.has(s.unit)).slice(0, 60)
  const courseText = [
    `Units in order:\n${order
      .map((id) => course.units.find((u) => u.id === id))
      .filter((u): u is Unit => Boolean(u))
      .map((u) => `- ${u.id}: ${u.title}${u.subtitle ? ` (${u.subtitle})` : ''}`)
      .join('\n')}`,
    `Cast:\n${course.characters.map((c) => `- ${c.id} (${c.name}, ${c.role}): ${c.bio.replace(/\s+/g, ' ')}`).join('\n')}`,
    `Allowed existing lexemes (id | fa | translit | glosses | forms):\n${
      vocabulary
        .map(
          (l) =>
            `- ${l.id} | ${l.fa} | ${l.translit} | ${l.glosses.join('; ')}${
              l.forms
                ? ` | ${Object.entries(l.forms)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ')}`
                : ''
            }`,
        )
        .join('\n') || '(none)'
    }`,
    earlierSentences.length
      ? `Earlier sentences usable as chat options (id | fa | en):\n${earlierSentences
          .map((s) => `- ${s.id} | ${s.fa} | ${modelAnswer(s, course)}`)
          .join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const messages: ChatMessage[] = [
    { role: 'system', content: renderSystem(DRAFT_UNIT, { style }) },
    {
      role: 'user',
      content: DRAFT_UNIT.user({
        style,
        brief: briefText,
        course: courseText,
        exemplar:
          exemplar ?? '(no exemplar unit available; follow the style guide and the output schema)',
      }),
    },
  ]
  return { unit, brief, vocabulary, exemplar, messages, maxTokens: 16_000 }
}

// ---------------------------------------------------------------------------------------------
// Model output → course items
// ---------------------------------------------------------------------------------------------

export interface DraftFiles {
  lexemes: string
  sentences: string
  chats: string
  unit: string
  guidebook: string
}

export function draftFiles(unitId: string): DraftFiles {
  return {
    lexemes: `lexemes/${unitId}.yaml`,
    sentences: `sentences/${unitId}.yaml`,
    chats: `chats/${unitId}.yaml`,
    unit: `units/${unitId}.yaml`,
    guidebook: `guidebooks/${unitId}.md`,
  }
}

export interface MaterializedDraft {
  unit: Unit
  lexemes: Lexeme[]
  sentences: Sentence[]
  chats: Chat[]
  guidebook: string
  /** Reference problems found while resolving the model's refs. */
  problems: string[]
}

const stripPunctuation = (s: string) =>
  fixPersianText(s)
    .replace(/[،؛؟«».!:]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const nullToUndef = <T>(v: T | null): T | undefined => (v === null ? undefined : v)
const one = (list: string[]): string | string[] => (list.length === 1 ? list[0]! : list)

/** Level ids: lessons u02-l1…, a chest after the second lesson, then practice and review. */
export function unitLevels(unitId: string, lessons: Omit<Level, 'id' | 'kind'>[]): Level[] {
  const p = unitPrefix(unitId)
  const levels: Level[] = []
  lessons.forEach((l, i) => {
    levels.push({ id: `${p}-l${i + 1}`, kind: 'lesson', ...l })
    if (i === 1 && lessons.length > 2) levels.push({ id: `${p}-c1`, kind: 'chest', lessons: 1 })
  })
  levels.push({ id: `${p}-p1`, kind: 'practice', lessons: 1 })
  levels.push({ id: `${p}-review`, kind: 'unit_review', lessons: 1 })
  return levels
}

/**
 * Turns the model output into items with allocated ids, house-style text fixes, `status: draft`
 * and provenance. `course` must already exclude this unit's previous draft items.
 */
export function materializeDraft(
  course: LoadedCourse,
  unit: Unit,
  out: DraftOutput,
  provenance: Provenance,
): MaterializedDraft {
  const problems: string[] = []
  const p = unitPrefix(unit.id)
  const takenLexemes = new Map(course.lexemes.map((l) => [l.id, l]))
  const takenSentences = new Set(course.sentences.map((s) => s.id))
  const takenChats = new Set(course.chats.map((c) => c.id))
  const castIds = new Set(course.characters.map((c) => c.id))

  // Lexemes: lx_<key>; a key that collides with an existing lexeme of the same Persian reuses it.
  const lexemeIds = new Map<string, string>()
  const lexemes: Lexeme[] = []
  for (const d of out.lexemes) {
    const fa = fixPersianText(d.fa)
    let id = `lx_${d.key}`
    const existing = takenLexemes.get(id)
    if (existing && existing.fa === fa) {
      lexemeIds.set(d.key, id)
      continue
    }
    for (let n = 2; takenLexemes.has(id); n++) id = `lx_${d.key}_${n}`
    lexemeIds.set(d.key, id)
    const lexeme: Lexeme = {
      id,
      fa,
      faFormal: nullToUndef(d.faFormal) && fixPersianText(d.faFormal!),
      faVocalized: nullToUndef(d.faVocalized) && fixPersianText(d.faVocalized!),
      translit: d.translit,
      translitFormal: nullToUndef(d.translitFormal),
      pos: d.pos,
      glosses: d.glosses,
      forms: d.forms.length
        ? Object.fromEntries(d.forms.map((f) => [f.key, fixPersianText(f.value)]))
        : undefined,
      introducedIn: unit.id,
      tags: d.tags.length ? d.tags : undefined,
      status: 'draft',
      provenance,
    }
    takenLexemes.set(id, lexeme)
    lexemes.push(lexeme)
  }
  const resolveLexeme = (ref: string): string => {
    const key = ref.startsWith('lx_') ? ref.slice(3) : ref
    if (lexemeIds.has(key)) return lexemeIds.get(key)!
    if (takenLexemes.has(ref)) return ref
    problems.push(`token or level lexeme ${ref} is neither an existing lexeme nor a new one`)
    return ref
  }

  // Sentences: s_<uNN>_<0001…>, continuing after any id already taken.
  const sentenceIds = new Map<string, string>()
  let next = 1
  const sentences: Sentence[] = []
  for (const d of out.sentences) {
    let id: string
    do id = `s_${p}_${String(next++).padStart(4, '0')}`
    while (takenSentences.has(id))
    takenSentences.add(id)
    if (sentenceIds.has(d.ref)) problems.push(`sentence ref ${d.ref} is used twice`)
    sentenceIds.set(d.ref, id)
    const faAccept = d.faAccept.map(stripPunctuation).filter(Boolean)
    const speaker = d.speaker && castIds.has(d.speaker) ? d.speaker : undefined
    if (d.speaker && !speaker) problems.push(`sentence ${d.ref}: unknown speaker ${d.speaker}`)
    sentences.push({
      id,
      fa: fixPersianText(d.fa),
      faFormal: nullToUndef(d.faFormal) && fixPersianText(d.faFormal!),
      faVocalized: nullToUndef(d.faVocalized) && fixPersianText(d.faVocalized!),
      translit: d.translit,
      translitFormal: nullToUndef(d.translitFormal),
      tokens: d.tokens.map((t) => ({
        surface: stripPunctuation(t.surface),
        lexeme: resolveLexeme(t.lexeme),
        translit: t.translit,
        gloss: t.gloss,
      })),
      en: one(d.en),
      faAccept: faAccept.length ? one(faAccept) : undefined,
      audio: speaker ? { speaker } : undefined,
      unit: unit.id,
      tags: d.tags.length ? d.tags : undefined,
      status: 'draft',
      provenance,
    })
  }
  const resolveSentence = (ref: string): string => {
    if (sentenceIds.has(ref)) return sentenceIds.get(ref)!
    if (course.sentences.some((s) => s.id === ref)) return ref
    problems.push(`sentence ref ${ref} does not exist`)
    return ref
  }

  // Chats: c_<uNN>_<001…>.
  const chatIds: string[] = []
  let nextChat = 1
  const chats: Chat[] = out.chats.map((d) => {
    let id: string
    do id = `c_${p}_${String(nextChat++).padStart(3, '0')}`
    while (takenChats.has(id))
    takenChats.add(id)
    chatIds.push(id)
    return {
      id,
      speaker: d.speaker,
      prompt: resolveSentence(d.prompt),
      options: d.options.map(resolveSentence),
      answer: d.answer,
      status: 'draft',
      provenance,
    }
  })

  const levels = unitLevels(
    unit.id,
    out.levels.map((l, i) => ({
      title: l.title,
      lessons: 4,
      spec: {
        focus: {
          lexemes: l.lexemes.map(resolveLexeme),
          sentences: l.sentences.map(resolveSentence),
          letters: [],
          chats: l.chats.map((c) => {
            const id = chatIds[c]
            if (!id) problems.push(`level "${l.title}": chat index ${c} does not exist`)
            return id ?? `c_${p}_missing_${c}`
          }),
        },
        mix: i === 0 ? 'intro' : 'standard',
        pinned: [],
        pinnedOnly: false,
      },
    })),
  )
  const files = draftFiles(unit.id)
  // JSON round trip drops undefined fields, so the YAML has no `key: null` noise.
  const clean = <T extends object>(o: T): T => JSON.parse(JSON.stringify(o)) as T
  const { id, title, subtitle, register, color, characters, status } = unit
  return {
    unit: clean({
      id,
      title,
      subtitle,
      register,
      color,
      guidebook: files.guidebook,
      characters,
      levels,
      status,
      provenance: { ...unit.provenance, ...provenance },
    }),
    lexemes: lexemes.map(clean),
    sentences: sentences.map(clean),
    chats,
    guidebook: `${out.guidebook.trim()}\n`,
    problems,
  }
}

/** A unit as authors write it: schema defaults (empty lists, lessons: 1, pinned) left out. */
export function unitForYaml(unit: Unit): object {
  return {
    ...unit,
    levels: unit.levels.map((l) => {
      const { lessons, spec, ...rest } = l
      if (!spec) return { ...rest, ...(lessons === 1 ? {} : { lessons }) }
      const focus = Object.fromEntries(Object.entries(spec.focus).filter(([, ids]) => ids.length))
      return {
        ...rest,
        lessons,
        spec: {
          focus,
          mix: spec.mix,
          ...(spec.length ? { length: spec.length } : {}),
          ...(spec.pinned.length ? { pinned: spec.pinned } : {}),
          ...(spec.pinnedOnly ? { pinnedOnly: true } : {}),
        },
      }
    }),
  }
}

/** The course with `unitId`'s previous draft files removed (their items are being replaced). */
export function withoutUnitDraft(course: LoadedCourse, unitId: string): LoadedCourse {
  const files = draftFiles(unitId)
  const c = structuredClone(course)
  const from = (kind: string, id: string, file: string) => c.sources.get(`${kind}:${id}`) === file
  c.lexemes = c.lexemes.filter((l) => !from('lexeme', l.id, files.lexemes))
  c.sentences = c.sentences.filter((s) => !from('sentence', s.id, files.sentences))
  c.chats = c.chats.filter((ch) => !from('chat', ch.id, files.chats))
  for (const [key, file] of [...c.sources])
    if (Object.values(files).includes(file) && !key.startsWith('unit:')) c.sources.delete(key)
  return c
}

/** Merges a draft into a course (in memory) for validation. */
export function mergeDraft(base: LoadedCourse, d: MaterializedDraft): LoadedCourse {
  const c = structuredClone(base)
  const files = draftFiles(d.unit.id)
  c.units = c.units.map((u) => (u.id === d.unit.id ? d.unit : u))
  c.lexemes.push(...d.lexemes)
  c.sentences.push(...d.sentences)
  c.chats.push(...d.chats)
  for (const l of d.lexemes) c.sources.set(`lexeme:${l.id}`, files.lexemes)
  for (const s of d.sentences) c.sources.set(`sentence:${s.id}`, files.sentences)
  for (const ch of d.chats) c.sources.set(`chat:${ch.id}`, files.chats)
  c.guidebooks.set(files.guidebook, d.guidebook)
  return c
}

/** Errors the draft introduces (errors already present in the course are not the draft's). */
export function draftErrors(
  base: LoadedCourse,
  merged: LoadedCourse,
  d: MaterializedDraft,
): string[] {
  const key = (i: ContentIssue) => `${i.file}: ${i.message}`
  const before = new Set(
    validateCourse(base, { allowDrafts: true })
      .filter((i) => i.severity === 'error')
      .map(key),
  )
  const after = validateCourse(merged, { allowDrafts: true })
    .filter((i) => i.severity === 'error')
    .map(key)
    .filter((k) => !before.has(k))
  return [...d.problems, ...after]
}

// ---------------------------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------------------------

export interface DraftOptions {
  course: LoadedCourse
  brief: UnitBrief
  ai?: AiClient
  /** Replace existing draft files for the unit. */
  force?: boolean
  /** Print prompts and cost; call nothing. */
  dryRun?: boolean
  /** Use the half-price :batch model. */
  batch?: boolean
  /** Write even when validation still fails after the repair round. */
  writeInvalid?: boolean
  now?: Date
  log?: (line: string) => void
}

export interface DraftResult {
  written: string[]
  errors: string[]
  costUsd: number
  repaired: boolean
  dryRun?: DryRunCall
}

export async function draftUnit(opts: DraftOptions): Promise<DraftResult> {
  const log = opts.log ?? (() => {})
  const plan = planDraft(opts.course, opts.brief)
  const model = opts.batch ? MODELS.content_text_batch : MODELS.content_text
  const files = draftFiles(plan.unit.id)
  if (opts.dryRun) {
    return {
      written: [],
      errors: [],
      costUsd: 0,
      repaired: false,
      dryRun: {
        label: `draft ${plan.unit.id}`,
        model,
        messages: plan.messages,
        maxOutputTokens: plan.maxTokens,
      },
    }
  }
  if (!opts.ai) throw new Error('draft needs an AI client (or --dry-run)')
  const existing = [files.lexemes, files.sentences, files.chats, files.guidebook].filter((f) =>
    existsSync(join(opts.course.dir, f)),
  )
  if (existing.length && !opts.force)
    throw new Error(`${existing.join(', ')} already exist; pass --force to replace the draft`)

  const base = withoutUnitDraft(opts.course, plan.unit.id)
  const provenance = aiProvenance(model, DRAFT_UNIT, { now: opts.now }) as Provenance
  const version = promptId(DRAFT_UNIT)
  let costUsd = 0
  const call = async (messages: ChatMessage[], label: string) => {
    const r = await opts.ai!.json(DraftOutput, {
      model,
      name: 'unit_draft',
      messages,
      maxTokens: plan.maxTokens,
      temperature: 0.4,
      promptVersion: version,
      label,
    })
    costUsd += r.costUsd
    log(
      `${label}: ${r.cached ? 'cached' : `$${r.costUsd.toFixed(4)}`}${r.repaired ? ' (JSON repaired)' : ''}`,
    )
    return r.value
  }

  let output = await call(plan.messages, `draft ${plan.unit.id}`)
  let draft = materializeDraft(base, plan.unit, output, provenance)
  let errors = draftErrors(base, mergeDraft(base, draft), draft)
  let repaired = false
  if (errors.length) {
    log(`draft ${plan.unit.id}: ${errors.length} validation problem(s); asking for one repair`)
    output = await call(
      [
        ...plan.messages,
        { role: 'assistant', content: JSON.stringify(output) },
        {
          role: 'user',
          content: `The course validator rejected this draft:\n${errors.map((e) => `- ${e}`).join('\n')}\n\nFix every problem and answer with the complete corrected JSON object.`,
        },
      ],
      `draft ${plan.unit.id} (repair)`,
    )
    draft = materializeDraft(base, plan.unit, output, provenance)
    errors = draftErrors(base, mergeDraft(base, draft), draft)
    repaired = true
  }
  if (errors.length && !opts.writeInvalid) return { written: [], errors, costUsd, repaired }

  const note = `AI draft (${provenance.model}, prompt ${provenance.prompt}). Every item is status: draft until a native reviewer checks it against STYLE.md and approves it.`
  const write = (rel: string, text: string) => {
    const abs = join(opts.course.dir, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, text)
    return rel
  }
  const written = [
    write(files.lexemes, listToYaml(draft.lexemes, `${plan.unit.title}: lexemes. ${note}`)),
    write(files.sentences, listToYaml(draft.sentences, `${plan.unit.title}: sentences. ${note}`)),
    ...(draft.chats.length
      ? [
          write(
            files.chats,
            listToYaml(draft.chats, `${plan.unit.title}: complete_chat items. ${note}`),
          ),
        ]
      : []),
    write(files.guidebook, draft.guidebook),
    write(
      files.unit,
      docToYaml(draft.unit, `${plan.unit.title}. Levels drafted by content-cli draft; ${note}`),
    ),
  ]
  return { written, errors, costUsd, repaired }
}

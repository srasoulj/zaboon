/**
 * `suggest` (LEARNING-ENGINE §4.1 step 2): drafts extra accepted-answer patterns and word-bank
 * distractors for a unit's sentences with the text model. Every suggestion is checked before a
 * reviewer sees it: patterns must compile and add something new; distractor tiles must never
 * complete an accepted answer (the §3.3 check). The result is a `status: draft` review file,
 * `suggestions/<unit>.yaml`; a native reviewer merges what they approve into the sentences.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { aiProvenance, MODELS, promptId, type AiClient, type ChatMessage } from '@zaboon/ai'
import { patternList, type AnswerGraph, type Sentence } from '@zaboon/content-schema'
import { accepts, compile, enumerate, type Lang } from '@zaboon/grader'
import type { DryRunCall } from './ai-context'
import { unsafeBankTiles } from './distractors'
import { fixPersianText } from './lint'
import type { LoadedCourse } from './load'
import { renderSystem, SUGGEST_VARIANTS } from './prompts'
import { compileSentence } from './validate'
import { listToYaml } from './yaml-out'

export const SuggestOutput = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1),
      en: z.array(z.string().min(1)),
      faAccept: z.array(z.string().min(1)),
      distractorsEn: z.array(z.string().min(1)),
      distractorsFa: z.array(z.string().min(1)),
      notes: z.string(),
    }),
  ),
})
export type SuggestOutput = z.infer<typeof SuggestOutput>

export interface Suggestion {
  sentence: string
  en?: string[]
  faAccept?: string[]
  bankDistractors?: { en?: string[]; fa?: string[] }
  /** Suggestions removed by the checks, with the reason (kept for the reviewer). */
  dropped?: string[]
  notes?: string
  status: 'draft'
  provenance: ReturnType<typeof aiProvenance>
}

export interface SuggestOptions {
  course: LoadedCourse
  unit: string
  /** Only these sentences (default: every sentence of the unit). */
  ids?: string[]
  ai?: AiClient
  dryRun?: boolean
  batch?: boolean
  /** Output file (default <course>/suggestions/<unit>.yaml). */
  out?: string
  force?: boolean
  now?: Date
  log?: (line: string) => void
}

export interface SuggestResult {
  file: string | null
  suggestions: Suggestion[]
  costUsd: number
  dryRun?: DryRunCall
}

const stripPunctuation = (s: string) =>
  fixPersianText(s)
    .replace(/[،؛؟«».!:]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

function describe(s: Sentence): string {
  return [
    `- id: ${s.id}`,
    `  fa: ${s.fa}`,
    s.faFormal ? `  faFormal: ${s.faFormal}` : '',
    `  en: ${JSON.stringify(patternList(s.en))}`,
    `  faAccept: ${JSON.stringify(s.faAccept === undefined ? [] : patternList(s.faAccept))}`,
    `  tokens: ${s.tokens.map((t) => `${t.surface}=${t.gloss ?? t.translit}`).join(' · ')}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Keeps the patterns that compile and accept something the current graph does not. */
function checkPatterns(
  lang: Lang,
  suggested: readonly string[],
  current: AnswerGraph,
  dropped: string[],
): string[] {
  const kept: string[] = []
  for (const raw of suggested) {
    const p = lang === 'fa' ? stripPunctuation(raw) : raw.trim()
    let graph: AnswerGraph
    try {
      graph = compile([p], { lang })
    } catch (e) {
      dropped.push(`${lang} "${raw}": does not compile (${(e as Error).message})`)
      continue
    }
    if (enumerate(graph, 500).every((answer) => accepts(current, answer, lang))) {
      dropped.push(`${lang} "${raw}": already accepted`)
      continue
    }
    if (!kept.includes(p)) kept.push(p)
  }
  return kept
}

export function checkSuggestion(
  course: LoadedCourse,
  s: Sentence,
  item: SuggestOutput['items'][number],
  provenance: Suggestion['provenance'],
): Suggestion {
  const dropped: string[] = []
  const graphs = compileSentence(s, course.variants)
  const en = checkPatterns('en', item.en, graphs.en, dropped)
  const faAccept = checkPatterns('fa', item.faAccept, graphs.fa, dropped)
  // Distractors are checked against the answers as they would be with the suggestions merged.
  const merged = compileSentence(
    {
      ...s,
      en: [...patternList(s.en), ...en],
      faAccept: [...(s.faAccept === undefined ? [s.fa] : patternList(s.faAccept)), ...faAccept],
    },
    course.variants,
  )
  const safeTiles = (lang: Lang, tiles: readonly string[]) => {
    const clean = [...new Set(tiles.map((t) => (lang === 'fa' ? stripPunctuation(t) : t.trim())))]
    const unsafe = new Set(unsafeBankTiles(merged[lang], lang, clean))
    for (const t of unsafe) dropped.push(`${lang} tile "${t}": can complete an accepted answer`)
    return clean.filter((t) => t && !unsafe.has(t))
  }
  const bankEn = safeTiles('en', item.distractorsEn)
  const bankFa = safeTiles('fa', item.distractorsFa)
  return {
    sentence: s.id,
    ...(en.length ? { en } : {}),
    ...(faAccept.length ? { faAccept } : {}),
    ...(bankEn.length || bankFa.length
      ? {
          bankDistractors: {
            ...(bankEn.length ? { en: bankEn } : {}),
            ...(bankFa.length ? { fa: bankFa } : {}),
          },
        }
      : {}),
    ...(dropped.length ? { dropped } : {}),
    ...(item.notes.trim() ? { notes: item.notes.trim() } : {}),
    status: 'draft',
    provenance,
  }
}

export async function suggestVariants(opts: SuggestOptions): Promise<SuggestResult> {
  const { course } = opts
  if (!course.units.some((u) => u.id === opts.unit)) throw new Error(`unknown unit ${opts.unit}`)
  const sentences = course.sentences.filter((s) =>
    opts.ids ? opts.ids.includes(s.id) : s.unit === opts.unit,
  )
  for (const id of opts.ids ?? [])
    if (!sentences.some((s) => s.id === id)) throw new Error(`unknown sentence ${id}`)
  if (sentences.length === 0) throw new Error(`unit ${opts.unit} has no sentences to suggest for`)
  const model = opts.batch ? MODELS.content_text_batch : MODELS.content_text
  const style = existsSync(join(course.dir, 'STYLE.md'))
    ? readFileSync(join(course.dir, 'STYLE.md'), 'utf8')
    : ''
  const messages: ChatMessage[] = [
    { role: 'system', content: renderSystem(SUGGEST_VARIANTS, { style }) },
    {
      role: 'user',
      content: SUGGEST_VARIANTS.user({ style, items: sentences.map(describe).join('\n') }),
    },
  ]
  const maxTokens = Math.min(16_000, 400 * sentences.length + 500)
  if (opts.dryRun)
    return {
      file: null,
      suggestions: [],
      costUsd: 0,
      dryRun: { label: `suggest ${opts.unit}`, model, messages, maxOutputTokens: maxTokens },
    }
  if (!opts.ai) throw new Error('suggest needs an AI client (or --dry-run)')
  const file = opts.out ?? join(course.dir, 'suggestions', `${opts.unit}.yaml`)
  if (existsSync(file) && !opts.force)
    throw new Error(`${file} already exists; review it first or pass --force`)

  const r = await opts.ai.json(SuggestOutput, {
    model,
    name: 'answer_suggestions',
    messages,
    maxTokens,
    temperature: 0.3,
    promptVersion: promptId(SUGGEST_VARIANTS),
    label: `suggest ${opts.unit}`,
  })
  const provenance = aiProvenance(model, SUGGEST_VARIANTS, { now: opts.now })
  const byId = new Map(sentences.map((s) => [s.id, s]))
  const suggestions: Suggestion[] = []
  for (const item of r.value.items) {
    const s = byId.get(item.id)
    if (!s) {
      opts.log?.(`suggest: ignoring unknown sentence ${item.id}`)
      continue
    }
    suggestions.push(checkSuggestion(course, s, item, provenance))
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(
    file,
    listToYaml(
      suggestions,
      `Suggested accepted answers and word-bank distractors for ${opts.unit} (content-cli suggest; ${provenance.model}, prompt ${provenance.prompt}). Drafts for native review: merge what you approve into sentences/${opts.unit}.yaml, then delete this file. Patterns that did not compile or were already accepted, and tiles that could complete an answer, are listed under "dropped".`,
    ),
  )
  return { file, suggestions, costUsd: r.costUsd }
}

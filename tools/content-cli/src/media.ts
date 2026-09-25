/**
 * AI media commands (LEARNING-ENGINE §4.1 steps 3–4, DESIGN-SYSTEM §7.4):
 *
 *   art  character and illustration images with the pinned GPT Image model, passing style-bible
 *        images as references;
 *   tts  draft audio with the pinned audio model, from `faVocalized` (vowel marks disambiguate),
 *        encoded with ffmpeg as the house MP3 (−16 LUFS, mono, 64 kbps).
 *
 * Every generated file gets a provenance sidecar (`<file>.yaml`), the item's YAML points at the new
 * media, and the item becomes `status: draft` again: nothing generated ships without approval.
 * Human recordings always win: `tts` never replaces audio that has no TTS sidecar.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  AiResponseError,
  extensionFor,
  mediaProvenance,
  MODELS,
  promptId,
  sniffImage,
  type AiClient,
  type ChatMessage,
  type ContentPart,
  type MediaProvenance,
  type SpeechResult,
} from '@zaboon/ai'
import type { DryRunCall } from './ai-context'
import { encodeTtsMp3, type FfmpegRunner } from './audio'
import type { LoadedCourse } from './load'
import { ART_CHARACTER, ART_ITEM, TTS_LINE } from './prompts'
import { setItemFields } from './yaml-out'

export const DEFAULT_VOICE = 'alloy'

const posix = (p: string) => p.split(sep).join('/')

function sidecarPath(course: LoadedCourse, ref: string): string {
  return join(course.dir, 'assets', `${ref}.yaml`)
}

export function readSidecar(course: LoadedCourse, ref: string): MediaProvenance | null {
  const file = sidecarPath(course, ref)
  return existsSync(file) ? (parseYaml(readFileSync(file, 'utf8')) as MediaProvenance) : null
}

function writeMedia(course: LoadedCourse, ref: string, bytes: Buffer, provenance: MediaProvenance) {
  const abs = join(course.dir, 'assets', ref)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, bytes)
  writeFileSync(
    sidecarPath(course, ref),
    `# Provenance of assets/${ref} (content-cli). Set status: approved and approvedBy after review.\n${stringifyYaml(provenance, { lineWidth: 0 })}`,
  )
}

function itemFile(course: LoadedCourse, kind: string, id: string): string {
  const rel = course.sources.get(`${kind}:${id}`)
  if (!rel) throw new Error(`no source file for ${kind} ${id}`)
  return join(course.dir, rel)
}

// ---------------------------------------------------------------------------------------------
// art
// ---------------------------------------------------------------------------------------------

export interface ArtOptions {
  course: LoadedCourse
  target: { kind: 'character' | 'lexeme'; id: string }
  ai?: AiClient
  /** Extra reference images (paths); style-bible images are added automatically. */
  refs?: string[]
  /** What to draw, e.g. "expression sheet: happy, sad, surprised" (a sensible default per kind). */
  sheet?: string
  dryRun?: boolean
  force?: boolean
  now?: Date
}

export interface ArtResult {
  ref: string | null
  costUsd: number
  references: string[]
  dryRun?: DryRunCall
}

/** Style-bible images relevant to a target: the shared sheets plus the character's own. */
export function styleBibleRefs(course: LoadedCourse, characterId?: string): string[] {
  const dir = join(course.dir, 'style-bible')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /\.(png|webp)$/i.test(f))
    .filter(
      (f) =>
        !/^[a-z0-9]+-(turnaround|expressions)/.test(f) ||
        (characterId && f.startsWith(`${characterId}-`)),
    )
    .sort()
    .map((f) => join(dir, f))
}

export async function generateArt(opts: ArtOptions): Promise<ArtResult> {
  const { course, target } = opts
  const character =
    target.kind === 'character' ? course.characters.find((c) => c.id === target.id) : undefined
  const lexeme =
    target.kind === 'lexeme' ? course.lexemes.find((l) => l.id === target.id) : undefined
  if (!character && !lexeme) throw new Error(`unknown ${target.kind} ${target.id}`)
  const template = character ? ART_CHARACTER : ART_ITEM
  const prompt = template.user(
    character
      ? {
          subject: character.name,
          description: `${character.role}; ${character.bio.replace(/\s+/g, ' ')}`,
          sheet: opts.sheet ?? 'front, three-quarter, side and back views',
        }
      : {
          subject: lexeme!.glosses[0]!,
          description: `${lexeme!.pos}; Persian ${lexeme!.fa}`,
          sheet: opts.sheet ?? 'Square composition with generous margins',
        },
  )
  const refFiles = [...styleBibleRefs(course, character?.id), ...(opts.refs ?? [])]
  const references = refFiles.map((f) => posix(relative(course.dir, f)))
  const model = MODELS.content_image
  if (opts.dryRun) {
    const content: ContentPart[] = [
      { type: 'text', text: prompt },
      ...references.map((r): ContentPart => ({ type: 'image_url', image_url: { url: r } })),
    ]
    const messages: ChatMessage[] = [
      { role: 'system', content: template.system },
      { role: 'user', content },
    ]
    return {
      ref: null,
      costUsd: 0,
      references,
      dryRun: {
        label: `art ${target.kind} ${target.id}`,
        model,
        messages,
        maxOutputTokens: 1_000,
        imageOutputTokens: 6_000,
      },
    }
  }
  if (!opts.ai) throw new Error('art needs an AI client (or --dry-run)')
  const current = character?.image ?? lexeme?.image
  if (current && existsSync(join(course.dir, 'assets', current)) && !opts.force)
    throw new Error(
      `${target.kind} ${target.id} already has assets/${current}; pass --force to replace it`,
    )

  const refs = refFiles.map((f) => {
    const bytes = readFileSync(f)
    const mime = sniffImage(bytes)
    if (!mime) throw new Error(`reference ${f} is not a PNG, WebP or JPEG image`)
    return { mime, bytes }
  })
  const r = await opts.ai.image(prompt, refs, {
    model,
    system: template.system,
    promptVersion: promptId(template),
    label: `art ${target.kind} ${target.id}`,
  })
  const ext = extensionFor(r.mime)
  const ref = character ? `img/characters/${character.id}.${ext}` : `img/${lexeme!.id}.${ext}`
  writeMedia(
    course,
    ref,
    r.bytes,
    mediaProvenance(ref, r.model, template, { references, now: opts.now }),
  )
  setItemFields(itemFile(course, target.kind, target.id), target.id, [
    { path: ['image'], value: ref },
    { path: ['status'], value: 'draft' },
  ])
  return { ref, costUsd: r.costUsd, references }
}

// ---------------------------------------------------------------------------------------------
// tts
// ---------------------------------------------------------------------------------------------

export interface TtsOptions {
  course: LoadedCourse
  unit: string
  /** Only these sentence/lexeme ids (default: every sentence of the unit). */
  ids?: string[]
  /** Also voice the unit's lexemes. */
  lexemes?: boolean
  /** Voice for lines whose speaker has no `voice` (and for lexemes). */
  voice?: string
  ai?: AiClient
  dryRun?: boolean
  /** Regenerate existing TTS clips (never human recordings). */
  force?: boolean
  now?: Date
  log?: (line: string) => void
  /** Tests: ffmpeg runner for the WAV → MP3 encode. */
  run?: FfmpegRunner
}

export interface TtsJob {
  kind: 'sentence' | 'lexeme'
  id: string
  text: string
  voice: string
  ref: string
}

export interface TtsResult {
  written: string[]
  skipped: { id: string; reason: string }[]
  costUsd: number
  dryRun?: DryRunCall[]
}

export function planTts(opts: TtsOptions): { jobs: TtsJob[]; skipped: TtsResult['skipped'] } {
  const { course } = opts
  if (!course.units.some((u) => u.id === opts.unit)) throw new Error(`unknown unit ${opts.unit}`)
  const voices = new Map(course.characters.map((c) => [c.id, c.voice]))
  const fallback = opts.voice ?? DEFAULT_VOICE
  const wanted = (id: string) => !opts.ids || opts.ids.includes(id)
  const jobs: TtsJob[] = []
  const skipped: TtsResult['skipped'] = []
  const consider = (job: TtsJob, current: string | undefined) => {
    if (current && existsSync(join(course.dir, 'assets', current))) {
      const side = readSidecar(course, current)
      if (!side) return void skipped.push({ id: job.id, reason: 'has a human recording' })
      if (!opts.force)
        return void skipped.push({ id: job.id, reason: 'already has TTS audio (use --force)' })
    }
    jobs.push(job)
  }
  for (const s of course.sentences) {
    if (s.unit !== opts.unit || !wanted(s.id)) continue
    const voice = (s.audio?.speaker && voices.get(s.audio.speaker)) || fallback
    consider(
      { kind: 'sentence', id: s.id, text: s.faVocalized ?? s.fa, voice, ref: `audio/${s.id}.mp3` },
      s.audio?.normal,
    )
  }
  if (opts.lexemes) {
    for (const l of course.lexemes) {
      if (l.introducedIn !== opts.unit || !wanted(l.id)) continue
      consider(
        {
          kind: 'lexeme',
          id: l.id,
          text: l.faVocalized ?? l.fa,
          voice: fallback,
          ref: `audio/${l.id}.mp3`,
        },
        l.audio,
      )
    }
  }
  return { jobs, skipped }
}

export async function generateTts(opts: TtsOptions): Promise<TtsResult> {
  const { course } = opts
  const { jobs, skipped } = planTts(opts)
  const model = MODELS.content_audio
  if (opts.dryRun) {
    return {
      written: [],
      skipped,
      costUsd: 0,
      dryRun: jobs.map((j) => ({
        label: `tts ${j.id} (voice ${j.voice})`,
        model,
        messages: [
          { role: 'system', content: TTS_LINE.instructions },
          { role: 'user', content: j.text },
        ],
        maxOutputTokens: 100,
        audioOutputTokens: 600,
      })),
    }
  }
  if (!opts.ai) throw new Error('tts needs an AI client (or --dry-run)')
  const written: string[] = []
  let costUsd = 0
  for (const j of jobs) {
    let r: SpeechResult
    try {
      r = await opts.ai.speech(j.text, j.voice, {
        model,
        instructions: TTS_LINE.instructions,
        promptVersion: promptId(TTS_LINE),
        label: `tts ${j.id}`,
      })
    } catch (e) {
      // An unusable answer (e.g. silent audio) skips this clip; budget and HTTP errors still stop.
      if (!(e instanceof AiResponseError)) throw e
      skipped.push({ id: j.id, reason: `not written, unusable audio: ${e.message}` })
      opts.log?.(`tts ${j.id}: ✘ ${e.message}`)
      continue
    }
    costUsd += r.costUsd
    writeMedia(
      course,
      j.ref,
      await encodeTtsMp3(r.bytes, opts.run),
      mediaProvenance(j.ref, r.model, TTS_LINE, { voice: j.voice, input: j.text, now: opts.now }),
    )
    setItemFields(
      itemFile(course, j.kind, j.id),
      j.id,
      j.kind === 'sentence'
        ? [
            { path: ['audio', 'normal'], value: j.ref },
            { path: ['audio', 'signedOffBy'], value: null },
            { path: ['status'], value: 'draft' },
          ]
        : [
            { path: ['audio'], value: j.ref },
            { path: ['status'], value: 'draft' },
          ],
    )
    written.push(j.ref)
    opts.log?.(`tts ${j.id}: assets/${j.ref}${r.cached ? ' (cached)' : ''}`)
  }
  return { written, skipped, costUsd }
}

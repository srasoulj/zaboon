/**
 * GET /api/guidebooks/:unitId: a unit's Guidebook markdown from the learner's course bundle.
 *
 * The content build hashes every media ref it copies (`audio/x.mp3` → `audio/x.<sha10>.mp3`) but
 * leaves the refs inside guidebook markdown as authored, so this module maps each
 * `<fa audio="audio/x.mp3">` ref to its hashed bundle ref and then to a public URL. A ref with no
 * media in the bundle (an outside URL included) becomes `audio=""` (no speaker button).
 */
import type { GuidebookResponse } from '@zaboon/contracts'
import { UnitId } from '@zaboon/content-schema'
import rehypeRaw from 'rehype-raw'
import type { Db } from '@zaboon/db'
import { withCourse } from './catalog'
import { mediaUrl, type LoadedBundle } from './content'
import { ApiError } from './errors'

/** `audio/x.0123456789.mp3` → `audio/x.mp3` (the build's hashedRef, reversed); null if not hashed. */
export function unhashedRef(ref: string): string | null {
  const m = /^(.+)\.[0-9a-f]{10}(\.[a-z0-9]+)$/.exec(ref)
  return m ? `${m[1]}${m[2]}` : null
}

/** Every media ref in the bundle: authoring ref → hashed ref (hashed refs also map to themselves). */
export function bundleMediaIndex(bundle: Pick<LoadedBundle, 'units' | 'letters' | 'characters'>) {
  const index = new Map<string, string>()
  const add = (hashed: string | undefined) => {
    if (!hashed) return
    index.set(hashed, hashed)
    const authored = unhashedRef(hashed)
    if (authored && !index.has(authored)) index.set(authored, hashed)
  }
  const lexemes = [...bundle.units.flatMap((u) => u.lexemes), ...bundle.letters.lexemes]
  for (const l of lexemes) {
    add(l.audio)
    add(l.image)
  }
  for (const s of bundle.units.flatMap((u) => u.sentences)) {
    add(s.audio?.normal)
    add(s.audio?.slow)
    add(s.audio?.envelope)
    add(s.audio?.formal)
  }
  for (const l of bundle.letters.track.letters) add(l.audio)
  for (const c of bundle.characters.characters) {
    add(c.image)
    add(c.rive)
  }
  return index
}

type RawTransform = ReturnType<typeof rehypeRaw>
type RawTree = Parameters<RawTransform>[0]
type RawFile = Parameters<RawTransform>[1]

/** The parts of a hast node this module reads (hast's types are not a direct dependency). */
interface HastNode {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** End offset (exclusive) of the start tag at `from`, honoring quoted attribute values. */
function startTagEnd(html: string, from: number): number {
  let quote: string | null = null
  for (let i = from + 1; i < html.length; i++) {
    const c = html[i]!
    if (quote) {
      if (c === quote) quote = null
    } else if ((c === '"' || c === "'") && /=\s*$/.test(html.slice(from, i))) quote = c
    else if (c === '>') return i + 1
  }
  return html.length
}

export interface FaStartTag {
  /** Offsets of the start tag (`<fa …>`) in the markdown, end exclusive. */
  start: number
  end: number
  /** The parsed `audio` attribute, or null when there is none. */
  audio: string | null
}

/**
 * Every `<fa>` start tag in the markdown, found by parsing it as HTML (parse5 via rehype-raw), so
 * quoting tricks (`title="a>b"`, `<fa/audio=…>`, a fake ` audio=` inside another attribute) are
 * read exactly like a browser would.
 */
export function faStartTags(markdown: string): FaStartTag[] {
  const tree = {
    type: 'root',
    children: [
      {
        type: 'raw',
        value: markdown,
        position: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 1, offset: markdown.length },
        },
      },
    ],
  } as unknown as RawTree
  // hast-util-raw only reads the text (for positions) and `message` from the file.
  const file = { value: markdown, toString: () => markdown, messages: [], message() {} }
  const root = rehypeRaw()(tree, file as unknown as RawFile) as unknown as HastNode
  const out: FaStartTag[] = []
  const walk = (node: HastNode) => {
    if (node.type === 'element' && node.tagName === 'fa') {
      const start = node.position?.start.offset
      if (start === undefined) throw new Error('guidebook <fa> element without a source position')
      const firstChild = node.children?.[0]?.position?.start.offset
      const audio = node.properties?.audio
      out.push({
        start,
        end: firstChild ?? startTagEnd(markdown, start),
        audio: typeof audio === 'string' ? audio : null,
      })
    }
    node.children?.forEach(walk)
  }
  walk(root)
  return out.sort((a, b) => a.start - b.start)
}

/**
 * Replaces every `<fa …>` start tag with `<fa audio="URL">`: the parsed `audio` ref resolved
 * through the bundle (`resolve`), `""` when it has none or it doesn't resolve. Other attributes
 * are dropped; the rest of the markdown is left byte for byte (sanitizing is the renderer's job).
 */
export function rewriteGuidebookAudio(
  markdown: string,
  resolve: (ref: string) => string | null,
): string {
  let out = ''
  let at = 0
  for (const tag of faStartTags(markdown)) {
    if (tag.start < at) continue
    const ref = tag.audio?.trim() ?? ''
    const url = ref ? resolve(ref) : null
    out += `${markdown.slice(at, tag.start)}<fa audio="${escapeAttr(url ?? '')}">`
    at = tag.end
  }
  return out + markdown.slice(at)
}

/** A resolver from authoring refs to public URLs for one bundle. */
export function guidebookAudioResolver(bundle: LoadedBundle): (ref: string) => string | null {
  const index = bundleMediaIndex(bundle)
  return (ref) => {
    const hashed = index.get(ref)
    return hashed ? mediaUrl(bundle, hashed) : null
  }
}

export interface GuidebookCtx {
  db: Db
  userId: string
  /** `?courseId=`, or null for the active course (same rule as GET /api/path). */
  courseId: string | null
  unitId: string
}

export function buildGuidebook(ctx: GuidebookCtx): Promise<GuidebookResponse> {
  if (!UnitId.safeParse(ctx.unitId).success) throw new ApiError('not_found', 'unknown unit')
  return withCourse(ctx, async (_tx, bundle) => {
    const unit = bundle.units.find((u) => u.unit.id === ctx.unitId)
    if (!unit) throw new ApiError('not_found', `unknown unit ${ctx.unitId}`)
    if (!unit.guidebook) throw new ApiError('not_found', `unit ${ctx.unitId} has no guidebook`)
    return {
      courseId: bundle.courseId,
      contentVersion: bundle.version,
      unitId: unit.unit.id,
      title: unit.unit.title,
      markdown: rewriteGuidebookAudio(unit.guidebook, guidebookAudioResolver(bundle)),
    }
  })
}

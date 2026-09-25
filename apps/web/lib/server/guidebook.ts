/**
 * GET /api/guidebooks/:unitId: a unit's Guidebook markdown from the learner's course bundle.
 *
 * The content build hashes every media ref it copies (`audio/x.mp3` → `audio/x.<sha10>.mp3`) but
 * leaves the refs inside guidebook markdown as authored, so this module maps each
 * `<fa audio="audio/x.mp3">` ref to its hashed bundle ref and then to a public URL. A ref with no
 * media in the bundle becomes `audio=""` (the page then shows no speaker button).
 */
import type { GuidebookResponse } from '@zaboon/contracts'
import { UnitId } from '@zaboon/content-schema'
import { withUserLock, type Db } from '@zaboon/db'
import { activeCourseId } from './catalog'
import { loadBundle, mediaUrl, requireCurrentVersion, type LoadedBundle } from './content'
import { ApiError } from './errors'
import { migrateEnrollment } from './path'

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

const FA_OPEN_TAG = /<fa\b[^>]*>/gi
const AUDIO_ATTR = /(\saudio\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * Rewrites the `audio` attribute of every `<fa>` open tag with `resolve(ref)` (null → `""`).
 * Everything else in the markdown is left byte for byte; sanitizing is the renderer's job.
 */
export function rewriteGuidebookAudio(
  markdown: string,
  resolve: (ref: string) => string | null,
): string {
  return markdown.replace(FA_OPEN_TAG, (tag) =>
    tag.replace(AUDIO_ATTR, (_all, prefix: string, dq?: string, sq?: string, bare?: string) => {
      const ref = (dq ?? sq ?? bare ?? '').trim()
      const url = ref ? resolve(ref) : null
      return `${prefix}"${escapeAttr(url ?? '')}"`
    }),
  )
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
  // Same steps as catalog.ts `withCourse` (not exported): the active course, its current bundle,
  // and the lazy path migration, all under the user lock.
  return withUserLock(ctx.db, ctx.userId, async (tx) => {
    const courseId = ctx.courseId ?? (await activeCourseId(tx, ctx.userId))
    const bundle = await loadBundle(await requireCurrentVersion(tx, courseId))
    await migrateEnrollment(tx, ctx.userId, bundle)
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

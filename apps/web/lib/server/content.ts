/**
 * Content loading: resolves a course's current version from content_versions and loads its immutable
 * bundle (ADR 0005). Bundles are cached per (course, version) forever; the current-version pointer
 * for 10 s. Local mode reads apps/web/public/content; production fetches from CONTENT_BASE_URL.
 */
import { readFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import {
  CharactersBundle,
  LettersBundle,
  Manifest,
  UnitBundle,
  type CompiledSentence,
  type Lexeme,
} from '@zaboon/content-schema'
import { repos, type Queryable } from '@zaboon/db'
import type { ContentView } from '@zaboon/session-engine'
import { serverEnv } from './env'
import { ApiError } from './errors'

export interface CourseVersion {
  courseId: string
  version: number
  bundlePath: string
}

export interface LoadedBundle extends CourseVersion {
  manifest: Manifest
  /** Unit bundles in path order. */
  units: UnitBundle[]
  letters: LettersBundle
  characters: CharactersBundle
}

const CURRENT_TTL_MS = 10_000
// Resolved values only: a lookup made on one request's transaction never becomes another's promise.
const currentCache = new Map<string, { at: number; value: CourseVersion | null }>()
const bundleCache = new Map<string, Promise<LoadedBundle>>()

/**
 * The course's current published version, or null when nothing is published.
 *
 * Inside withUser/withUserLock pass the transaction, never the pool: a request that holds a pooled
 * connection and waits for a second one deadlocks once every connection is held by requests
 * queued on the same user's advisory lock.
 */
export async function currentVersion(
  q: Queryable,
  courseId: string,
): Promise<CourseVersion | null> {
  const hit = currentCache.get(courseId)
  if (hit && Date.now() - hit.at < CURRENT_TTL_MS) return hit.value
  const cv = await repos.content.getCurrentContentVersion(q, courseId)
  const value = cv ? { courseId, version: cv.version, bundlePath: cv.bundlePath } : null
  currentCache.set(courseId, { at: Date.now(), value })
  return value
}

/** Tests only: forget cached current-version pointers (after publishing a new version). */
export function resetContentCache(): void {
  currentCache.clear()
}

export async function requireCurrentVersion(
  q: Queryable,
  courseId: string,
): Promise<CourseVersion> {
  const cv = await currentVersion(q, courseId)
  if (!cv) throw new ApiError('not_found', `no published content for course ${courseId}`)
  return cv
}

/** A specific (immutable) version, e.g. the one a session was created with. Same `q` rule as above. */
export async function versionOf(
  q: Queryable,
  courseId: string,
  version: number,
): Promise<CourseVersion> {
  const cv = await repos.content.getContentVersion(q, courseId, version)
  if (!cv) throw new ApiError('gone', `content version ${courseId}@${version} is not available`)
  return { courseId, version: cv.version, bundlePath: cv.bundlePath }
}

function localContentRoot(): string {
  return process.env.ZABOON_CONTENT_DIR ?? join(process.cwd(), 'public', 'content')
}

async function readJson(bundlePath: string, file: string): Promise<unknown> {
  const base = serverEnv().contentBaseUrl
  if (base) {
    const res = await fetch(`${base.replace(/\/+$/, '')}/${bundlePath}/${file}`)
    if (!res.ok) throw new Error(`content fetch failed: ${res.status} ${bundlePath}/${file}`)
    return res.json()
  }
  // Local files serve tests and `content publish --local` only; deployments fetch bundles from
  // CONTENT_BASE_URL. The ignore comments keep Turbopack from tracing the whole project into the
  // server bundle for this dynamic path (it cannot scope it statically).
  const path = join(/*turbopackIgnore: true*/ localContentRoot(), bundlePath, file)
  return JSON.parse(await readFile(/*turbopackIgnore: true*/ path, 'utf8')) as unknown
}

export function loadBundle(cv: CourseVersion): Promise<LoadedBundle> {
  const key = `${cv.courseId}@${cv.version}`
  let hit = bundleCache.get(key)
  if (!hit) {
    hit = (async () => {
      const manifest = Manifest.parse(await readJson(cv.bundlePath, 'manifest.json'))
      const unitIds = manifest.sections.flatMap((s) => s.units.map((u) => u.id))
      const units = await Promise.all(
        unitIds.map(async (id) =>
          UnitBundle.parse(await readJson(cv.bundlePath, manifest.units[id]!)),
        ),
      )
      const letters = LettersBundle.parse(await readJson(cv.bundlePath, manifest.letters))
      const characters = CharactersBundle.parse(await readJson(cv.bundlePath, manifest.characters))
      return { ...cv, manifest, units, letters, characters }
    })()
    bundleCache.set(key, hit)
    hit.catch(() => bundleCache.delete(key))
  }
  return hit
}

/** Public URL of a bundle media ref (relative to the manifest's assetsBase). */
export function mediaUrl(bundle: CourseVersion & { manifest: Manifest }, ref: string): string {
  const rel = posix.normalize(`${bundle.bundlePath}/${bundle.manifest.assetsBase}${ref}`)
  const base = serverEnv().contentBaseUrl
  return base ? `${base.replace(/\/+$/, '')}/${rel}` : `/content/${rel}`
}

export interface LevelLocation {
  unitIndex: number
  unit: UnitBundle
  level: UnitBundle['unit']['levels'][number]
}

export function findLevel(bundle: LoadedBundle, levelId: string): LevelLocation | null {
  for (const [unitIndex, unit] of bundle.units.entries()) {
    const level = unit.unit.levels.find((l) => l.id === levelId)
    if (level) return { unitIndex, unit, level }
  }
  return null
}

/** Every lexeme in the bundle (units in path order, then letter examples), first definition wins. */
export function allLexemes(bundle: LoadedBundle): Map<string, Lexeme> {
  const out = new Map<string, Lexeme>()
  for (const u of bundle.units) for (const l of u.lexemes) if (!out.has(l.id)) out.set(l.id, l)
  for (const l of bundle.letters.lexemes) if (!out.has(l.id)) out.set(l.id, l)
  return out
}

/** What the session engine may read for a level: its unit plus everything taught up to it. */
export function contentView(bundle: LoadedBundle, unitIndex: number | null): ContentView {
  const upTo = unitIndex === null ? [] : bundle.units.slice(0, unitIndex + 1)
  const lexemes = new Map<string, Lexeme>()
  for (const l of bundle.letters.lexemes) lexemes.set(l.id, l)
  for (const u of upTo) for (const l of u.lexemes) lexemes.set(l.id, l)
  const sentences = new Map<string, CompiledSentence>()
  for (const u of upTo) for (const s of u.sentences) sentences.set(s.id, s)
  return {
    manifest: bundle.manifest,
    unit: unitIndex === null ? null : bundle.units[unitIndex]!,
    letters: bundle.letters,
    characters: bundle.characters,
    knownLexemes: [...lexemes.values()],
    knownSentences: [...sentences.values()],
    mediaUrl: (ref) => mediaUrl(bundle, ref),
  }
}

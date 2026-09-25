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
import { repos, type Db } from '@zaboon/db'
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
const currentCache = new Map<string, { at: number; value: Promise<CourseVersion | null> }>()
const bundleCache = new Map<string, Promise<LoadedBundle>>()

/** The course's current published version, or null when nothing is published. */
export function currentVersion(db: Db, courseId: string): Promise<CourseVersion | null> {
  const hit = currentCache.get(courseId)
  if (hit && Date.now() - hit.at < CURRENT_TTL_MS) return hit.value
  const value = repos.content
    .getCurrentContentVersion(db, courseId)
    .then((cv) => (cv ? { courseId, version: cv.version, bundlePath: cv.bundlePath } : null))
  currentCache.set(courseId, { at: Date.now(), value })
  value.catch(() => currentCache.delete(courseId))
  return value
}

export async function requireCurrentVersion(db: Db, courseId: string): Promise<CourseVersion> {
  const cv = await currentVersion(db, courseId)
  if (!cv) throw new ApiError('not_found', `no published content for course ${courseId}`)
  return cv
}

/** A specific (immutable) version, e.g. the one a session was created with. */
export async function versionOf(db: Db, courseId: string, version: number): Promise<CourseVersion> {
  const cv = await repos.content.getContentVersion(db, courseId, version)
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
  return JSON.parse(await readFile(join(localContentRoot(), bundlePath, file), 'utf8')) as unknown
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

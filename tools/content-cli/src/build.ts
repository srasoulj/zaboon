/**
 * `build`: compiles a validated course into an immutable, versioned bundle (LEARNING-ENGINE §4.3,
 * ADR 0005). Output layout, relative to the course output root:
 *
 *   v<N>/manifest.json        Manifest (sections, level list, bundle paths)
 *   v<N>/units/<unit>.json    UnitBundle (unit spec, lexemes, sentences + answer graphs, chats, guidebook)
 *   v<N>/letters.json         LettersBundle
 *   v<N>/characters.json      CharactersBundle
 *   v<N>/build-info.json      { contentHash, includesDrafts } (publish uses it to skip no-op releases)
 *   assets/<dir>/<name>.<sha>.<ext>  content-hashed media shared by every version (manifest.assetsBase = "../assets/")
 *
 * The build is pure: it returns the files in memory; `writeBundle` puts them on disk.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  CharactersBundle,
  CONTENT_SCHEMA_VERSION,
  LettersBundle,
  Manifest,
  UnitBundle,
  type Character,
  type Letter,
  type Lexeme,
  type ManifestUnit,
  type Sentence,
  type Unit,
} from '@zaboon/content-schema'
import type { ContentIssue, LoadedCourse } from './load'
import {
  compileSentence,
  formatIssues,
  hasErrors,
  kindOf,
  mediaRefs,
  validateCourse,
} from './validate'

export const ASSETS_BASE = '../assets/'

export class BuildError extends Error {
  constructor(readonly issues: ContentIssue[]) {
    super(`content has errors:\n${formatIssues(issues.filter((i) => i.severity === 'error'))}`)
  }
}

export interface BuildOptions {
  version: number
  allowDrafts: boolean
  now?: Date
}

export interface BuiltBundle {
  courseId: string
  version: number
  manifest: Manifest
  /** Path relative to the course output root → bytes. */
  files: Map<string, Buffer>
  /** Hash over all content except version/generatedAt: equal hashes mean identical releases. */
  contentHash: string
  includesDrafts: boolean
  warnings: ContentIssue[]
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')

/** "audio/lx_ab.mp3" + bytes → "audio/lx_ab.<10 hex>.mp3" */
export function hashedRef(ref: string, bytes: Buffer): string {
  const dot = ref.lastIndexOf('.')
  return `${ref.slice(0, dot)}.${sha256(bytes).slice(0, 10)}${ref.slice(dot)}`
}

export function buildCourse(course: LoadedCourse, opts: BuildOptions): BuiltBundle {
  const issues = validateCourse(course, { allowDrafts: opts.allowDrafts })
  if (hasErrors(issues) || !course.course || !course.letters) throw new BuildError(issues)
  const meta = course.course
  const letterTrack = course.letters

  // --- media: hash, copy, and map authoring refs → hashed refs ----------------------------------
  const files = new Map<string, Buffer>()
  const media = new Map<string, string>()
  for (const { ref } of mediaRefs(course)) {
    const abs = course.assets.get(ref)
    if (!abs || media.has(ref)) continue // missing draft media is dropped (validate warned)
    const bytes = readFileSync(abs)
    const hashed = hashedRef(ref, bytes)
    media.set(ref, hashed)
    files.set(`assets/${hashed}`, bytes)
  }
  const m = (ref: string | undefined): string | undefined =>
    ref === undefined ? undefined : media.get(ref)
  const defined = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

  const lexeme = (l: Lexeme): Lexeme => defined({ ...l, audio: m(l.audio), image: m(l.image) })
  const sentence = (s: Sentence) =>
    defined({
      ...s,
      audio: s.audio
        ? defined({
            ...s.audio,
            normal: m(s.audio.normal),
            slow: m(s.audio.slow),
            envelope: m(s.audio.envelope),
            formal: m(s.audio.formal),
          })
        : undefined,
      graphs: compileSentence(s, course.variants),
    })
  const letter = (l: Letter): Letter => defined({ ...l, audio: m(l.audio) })
  const character = (c: Character): Character =>
    defined({ ...c, image: m(c.image), rive: m(c.rive) })

  const sentences = new Map(course.sentences.map((s) => [s.id, s]))
  const chats = new Map(course.chats.map((c) => [c.id, c]))

  // --- unit bundles ---------------------------------------------------------------------------
  const unitBundles = new Map<string, UnitBundle>()
  for (const u of course.units) {
    const lx = new Set<string>()
    const st = new Set<string>()
    const ch = new Set<string>()
    const addRef = (id: string) => {
      const kind = kindOf(id)
      if (kind === 'lexeme') lx.add(id)
      else if (kind === 'sentence') st.add(id)
      else if (kind === 'chat') ch.add(id)
    }
    for (const l of course.lexemes) if (l.introducedIn === u.id) lx.add(l.id)
    for (const s of course.sentences) if (s.unit === u.id) st.add(s.id)
    for (const level of u.levels) {
      if (!level.spec) continue
      const { focus, pinned } = level.spec
      ;[...focus.lexemes, ...focus.sentences, ...focus.chats].forEach(addRef)
      for (const p of pinned) [...p.items, ...(p.distractors ?? [])].forEach(addRef)
    }
    for (const id of ch) {
      const c = chats.get(id)!
      ;[c.prompt, ...c.options].forEach((sid) => st.add(sid))
    }
    for (const id of st) for (const t of sentences.get(id)!.tokens) if (t.lexeme) lx.add(t.lexeme)

    const bundle: UnitBundle = {
      schema: CONTENT_SCHEMA_VERSION,
      unit: u,
      lexemes: course.lexemes.filter((l) => lx.has(l.id)).map(lexeme),
      sentences: course.sentences.filter((s) => st.has(s.id)).map(sentence),
      chats: course.chats.filter((c) => ch.has(c.id)),
      ...(u.guidebook ? { guidebook: course.guidebooks.get(u.guidebook) } : {}),
    }
    unitBundles.set(u.id, UnitBundle.parse(bundle))
  }

  // --- letters + characters -------------------------------------------------------------------
  const exampleIds = new Set(letterTrack.letters.flatMap((l) => l.examples))
  const lettersBundle = LettersBundle.parse({
    schema: CONTENT_SCHEMA_VERSION,
    track: { letters: letterTrack.letters.map(letter), lessons: letterTrack.lessons },
    lexemes: course.lexemes.filter((l) => exampleIds.has(l.id)).map(lexeme),
  })
  const charactersBundle = CharactersBundle.parse({
    schema: CONTENT_SCHEMA_VERSION,
    characters: course.characters.map(character),
  })

  // --- manifest -------------------------------------------------------------------------------
  const units = new Map(course.units.map((u) => [u.id, u]))
  const manifestUnit = (u: Unit): ManifestUnit =>
    defined({
      id: u.id,
      title: u.title,
      subtitle: u.subtitle,
      color: u.color,
      register: u.register,
      hasGuidebook: Boolean(u.guidebook),
      levels: u.levels.map((l) =>
        defined({ id: l.id, kind: l.kind, title: l.title, lessons: l.lessons }),
      ),
    })
  const includesDrafts = [
    ...course.units,
    ...course.lexemes,
    ...course.sentences,
    ...course.chats,
    ...letterTrack.letters,
    ...course.characters,
  ].some((i) => i.status === 'draft')

  const manifestBody = {
    schema: CONTENT_SCHEMA_VERSION,
    courseId: meta.id,
    title: meta.title,
    includesDrafts,
    sections: meta.sections.map((s) => ({
      id: s.id,
      title: s.title,
      cefr: s.cefr,
      units: s.units.map((id) => manifestUnit(units.get(id)!)),
    })),
    units: Object.fromEntries(course.units.map((u) => [u.id, `units/${u.id}.json`])),
    letters: 'letters.json',
    characters: 'characters.json',
    pathMigrations: [],
    assetsBase: ASSETS_BASE,
  }

  const payload: [string, unknown][] = [
    ...[...unitBundles].map(([id, b]) => [`units/${id}.json`, b] as [string, unknown]),
    ['letters.json', lettersBundle],
    ['characters.json', charactersBundle],
  ]
  const contentHash = sha256(
    JSON.stringify({
      manifest: manifestBody,
      payload,
      assets: [...files.keys()].sort(),
    }),
  )

  const manifest = Manifest.parse({
    ...manifestBody,
    version: opts.version,
    generatedAt: (opts.now ?? new Date()).toISOString(),
  })
  const v = `v${opts.version}`
  files.set(`${v}/manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2)))
  for (const [path, body] of payload) files.set(`${v}/${path}`, Buffer.from(JSON.stringify(body)))
  files.set(
    `${v}/build-info.json`,
    Buffer.from(JSON.stringify({ contentHash, includesDrafts }, null, 2)),
  )

  return {
    courseId: meta.id,
    version: opts.version,
    manifest,
    files,
    contentHash,
    includesDrafts,
    warnings: issues.filter((i) => i.severity === 'warning'),
  }
}

/**
 * Writes a bundle under `<outRoot>/<courseId>/`. Hashed assets are written once and never
 * change; an existing `v<N>/` is replaced only with `overwrite` (local publish of an orphaned
 * version whose database row was never written).
 */
export function writeBundle(
  bundle: BuiltBundle,
  outRoot: string,
  opts: { overwrite?: boolean } = {},
): string {
  const root = join(outRoot, bundle.courseId)
  const manifestPath = join(root, `v${bundle.version}`, 'manifest.json')
  if (existsSync(manifestPath) && !opts.overwrite) {
    throw new Error(`${manifestPath} already exists; versions are immutable (pick a new --version)`)
  }
  for (const [rel, bytes] of bundle.files) {
    const target = join(root, rel)
    if (rel.startsWith('assets/') && existsSync(target)) continue
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }
  return root
}

/** Reads `build-info.json` of a written version, or null when absent/unreadable. */
export function readBuildInfo(
  dir: string,
): { contentHash: string; includesDrafts: boolean } | null {
  try {
    const info = JSON.parse(readFileSync(join(dir, 'build-info.json'), 'utf8')) as unknown
    if (
      info &&
      typeof info === 'object' &&
      'contentHash' in info &&
      typeof info.contentHash === 'string'
    ) {
      return info as { contentHash: string; includesDrafts: boolean }
    }
    return null
  } catch {
    return null
  }
}

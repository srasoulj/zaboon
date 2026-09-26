/**
 * TEST SUPPORT (not exported from the package): loads a course directory's YAML straight into
 * ContentViews, mirroring `content-cli build` closely enough for engine tests without depending on
 * the CLI: schema-parsed items, answer graphs compiled with @zaboon/grader, and media refs dropped
 * when the asset file is missing (as the build does).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import {
  CONTENT_SCHEMA_VERSION,
  Character,
  Chat,
  Course,
  LettersTrack,
  Lexeme,
  OrthographyVariants,
  Sentence,
  Story,
  Unit,
  patternList,
} from '@zaboon/content-schema'
import type { CompiledSentence, Manifest, UnitBundle } from '@zaboon/content-schema'
import { compile } from '@zaboon/grader'
import type { ContentView } from '../content'

export const REPO_ROOT = new URL('../../../../', import.meta.url).pathname
export const courseDir = (course: string) => join(REPO_ROOT, 'content', course)

const readYaml = (file: string): unknown => parse(readFileSync(file, 'utf8'))
const yamlFiles = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.yaml'))
        .sort()
        .map((f) => join(dir, f))
    : []
const list = <T>(dir: string, parseItem: (v: unknown) => T): T[] =>
  yamlFiles(dir).flatMap((f) => ((readYaml(f) as unknown[] | null) ?? []).map(parseItem))

export interface LoadedCourse {
  course: Course
  units: Unit[]
  /** A ContentView for a unit (null: letters-only). */
  view(unitId: string | null): ContentView
}

export function loadCourse(course: string): LoadedCourse {
  const dir = courseDir(course)
  const meta = Course.parse(readYaml(join(dir, 'course.yaml')))
  const media = (ref: string | undefined) =>
    ref !== undefined && existsSync(join(dir, 'assets', ref)) ? ref : undefined
  const variantsFile = join(dir, 'orthography-variants.yaml')
  const variants = existsSync(variantsFile) ? OrthographyVariants.parse(readYaml(variantsFile)) : []

  const strip = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
  const lexemes = list(join(dir, 'lexemes'), (v) => {
    const l = Lexeme.parse(v)
    return strip({ ...l, audio: media(l.audio), image: media(l.image) })
  })
  const sentences: CompiledSentence[] = list(join(dir, 'sentences'), (v) => {
    const s = Sentence.parse(v)
    const audio = s.audio
      ? strip({
          ...s.audio,
          normal: media(s.audio.normal),
          slow: media(s.audio.slow),
          envelope: media(s.audio.envelope),
          formal: media(s.audio.formal),
        })
      : undefined
    return strip({
      ...s,
      audio,
      graphs: {
        en: compile(patternList(s.en), { lang: 'en' }),
        fa: compile(s.faAccept === undefined ? [s.fa] : patternList(s.faAccept), {
          lang: 'fa',
          ...(s.faFormal === undefined ? {} : { formal: s.faFormal }),
          pronounDrop: s.pronounDrop ?? true,
          variants,
        }),
      },
    })
  })
  const chats = list(join(dir, 'chats'), (v) => Chat.parse(v))
  const stories = list(join(dir, 'stories'), (v) => {
    const st = Story.parse(v)
    return strip({
      ...st,
      image: media(st.image),
      lines: st.lines.map((l) => strip({ ...l, audio: media(l.audio) })),
    })
  })
  const lettersRaw = readYaml(join(dir, 'letters.yaml'))
  const track = LettersTrack.parse(lettersRaw)
  track.letters = track.letters.map((l) => strip({ ...l, audio: media(l.audio) }))
  const characters = ((readYaml(join(dir, 'characters.yaml')) as unknown[] | null) ?? []).map((c) =>
    Character.parse(c),
  )
  const unitOrder = meta.sections.flatMap((s) => s.units)
  const units = yamlFiles(join(dir, 'units'))
    .map((f) => Unit.parse(readYaml(f)))
    .sort((a, b) => unitOrder.indexOf(a.id) - unitOrder.indexOf(b.id))

  const exampleIds = new Set(track.letters.flatMap((l) => l.examples))
  const letters = {
    schema: CONTENT_SCHEMA_VERSION,
    track,
    lexemes: lexemes.filter((l) => exampleIds.has(l.id)),
  }
  const manifest = {
    schema: CONTENT_SCHEMA_VERSION,
    courseId: meta.id,
    title: meta.title,
  } as Manifest
  const byId = <T extends { id: string }>(xs: readonly T[]) => new Map(xs.map((x) => [x.id, x]))
  const lxById = byId(lexemes)
  const stById = byId(sentences)
  const chById = byId(chats)

  function bundle(u: Unit): UnitBundle {
    const lx = new Set(lexemes.filter((l) => l.introducedIn === u.id).map((l) => l.id))
    const st = new Set(sentences.filter((s) => s.unit === u.id).map((s) => s.id))
    const ch = new Set<string>()
    for (const level of u.levels) {
      if (!level.spec) continue
      const { focus, pinned } = level.spec
      for (const id of [
        ...focus.lexemes,
        ...focus.sentences,
        ...focus.chats,
        ...pinned.flatMap((p) => [...p.items, ...(p.distractors ?? [])]),
      ]) {
        if (lxById.has(id)) lx.add(id)
        else if (stById.has(id)) st.add(id)
        else if (chById.has(id)) ch.add(id)
      }
    }
    for (const id of ch)
      for (const sid of [chById.get(id)!.prompt, ...chById.get(id)!.options]) st.add(sid)
    for (const id of st)
      for (const t of stById.get(id)!.tokens) if (t.lexeme && lxById.has(t.lexeme)) lx.add(t.lexeme)
    return {
      schema: CONTENT_SCHEMA_VERSION,
      unit: u,
      lexemes: lexemes.filter((l) => lx.has(l.id)),
      sentences: sentences.filter((s) => st.has(s.id)),
      chats: chats.filter((c) => ch.has(c.id)),
      ...(stories.some((x) => x.unit === u.id)
        ? { stories: stories.filter((x) => x.unit === u.id) }
        : {}),
    }
  }

  return {
    course: meta,
    units,
    view(unitId) {
      const upto =
        unitId === null ? [] : units.slice(0, units.findIndex((u) => u.id === unitId) + 1)
      if (unitId !== null && upto.length === 0) throw new Error(`unknown unit ${unitId}`)
      const bundles = upto.map(bundle)
      const uniq = <T extends { id: string }>(xs: T[]) => [...byId(xs).values()]
      return {
        manifest,
        unit: bundles.at(-1) ?? null,
        letters,
        characters: { schema: CONTENT_SCHEMA_VERSION, characters },
        knownLexemes: uniq(bundles.flatMap((b) => b.lexemes)),
        knownSentences: uniq(bundles.flatMap((b) => b.sentences)),
        mediaUrl: (ref) => `/media/${course}/${ref}`,
        orthographyVariants: variants,
      }
    },
  }
}

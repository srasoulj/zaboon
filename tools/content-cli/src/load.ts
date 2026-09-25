/**
 * Loads a course directory (content/<course>/) into typed, schema-checked objects.
 *
 * Layout (docs/LEARNING-ENGINE.md §2):
 *   course.yaml · units/*.yaml · lexemes/*.yaml · sentences/*.yaml · chats/*.yaml
 *   letters.yaml · characters.yaml · orthography-variants.yaml · guidebooks/*.md · assets/**
 *
 * Loading never throws on bad content: every problem becomes a ContentIssue so `validate` can
 * report all of them at once.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { z } from 'zod'
import {
  Character,
  Chat,
  Course,
  LettersTrack,
  Lexeme,
  OrthographyVariants,
  Sentence,
  Unit,
} from '@zaboon/content-schema'

export interface ContentIssue {
  severity: 'error' | 'warning'
  /** Path relative to the course directory. */
  file: string
  message: string
}

export interface LoadedCourse {
  dir: string
  course: Course | null
  /** Units in file order; `validate` checks them against the course sections. */
  units: Unit[]
  lexemes: Lexeme[]
  sentences: Sentence[]
  chats: Chat[]
  letters: LettersTrack | null
  characters: Character[]
  variants: OrthographyVariants
  /** guidebook path relative to the course dir (e.g. "guidebooks/u01-food.md") → markdown. */
  guidebooks: Map<string, string>
  /** media ref relative to assets/ (e.g. "audio/lx_ab.mp3") → absolute file path. */
  assets: Map<string, string>
  /** "<kind>:<id>" → file the item came from (for error messages). */
  sources: Map<string, string>
  issues: ContentIssue[]
}

function listFiles(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => join(dir, f))
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

function formatZodError(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
}

export function loadCourse(dir: string): LoadedCourse {
  const loaded: LoadedCourse = {
    dir,
    course: null,
    units: [],
    lexemes: [],
    sentences: [],
    chats: [],
    letters: null,
    characters: [],
    variants: [],
    guidebooks: new Map(),
    assets: new Map(),
    sources: new Map(),
    issues: [],
  }
  const rel = (p: string) => relative(dir, p).split(sep).join('/')
  const error = (file: string, message: string) =>
    loaded.issues.push({ severity: 'error', file: rel(file), message })

  const readYaml = (file: string): unknown => {
    try {
      return parseYaml(readFileSync(file, 'utf8'))
    } catch (e) {
      error(file, `YAML parse error: ${(e as Error).message}`)
      return undefined
    }
  }

  function parseOne<S extends z.ZodType>(
    file: string,
    schema: S,
    value: unknown,
    label: string,
  ): z.infer<S> | null {
    const r = schema.safeParse(value)
    if (r.success) return r.data
    for (const m of formatZodError(r.error)) error(file, `${label}: ${m}`)
    return null
  }

  /** A YAML file holding a list of items; each item is checked on its own. */
  function parseList<S extends z.ZodType<{ id: string }>>(
    file: string,
    schema: S,
    kind: string,
  ): z.infer<S>[] {
    const raw = readYaml(file)
    if (raw === undefined || raw === null) return []
    if (!Array.isArray(raw)) {
      error(file, `expected a list of ${kind} items`)
      return []
    }
    const out: z.infer<S>[] = []
    raw.forEach((item: unknown, i) => {
      const id =
        typeof item === 'object' && item && 'id' in item
          ? String((item as { id: unknown }).id)
          : `#${i}`
      const parsed = parseOne(file, schema, item, `${kind} ${id}`)
      if (parsed) {
        out.push(parsed)
        const key = `${kind}:${parsed.id}`
        if (loaded.sources.has(key))
          error(file, `duplicate ${kind} id ${parsed.id} (also in ${loaded.sources.get(key)})`)
        else loaded.sources.set(key, rel(file))
      }
    })
    return out
  }

  if (!existsSync(dir)) {
    loaded.issues.push({
      severity: 'error',
      file: '.',
      message: `course directory not found: ${dir}`,
    })
    return loaded
  }

  const courseFile = join(dir, 'course.yaml')
  if (existsSync(courseFile))
    loaded.course = parseOne(courseFile, Course, readYaml(courseFile), 'course')
  else error(courseFile, 'missing course.yaml')

  for (const file of listFiles(join(dir, 'units'), '.yaml')) {
    const unit = parseOne(file, Unit, readYaml(file), 'unit')
    if (!unit) continue
    const key = `unit:${unit.id}`
    if (loaded.sources.has(key))
      error(file, `duplicate unit id ${unit.id} (also in ${loaded.sources.get(key)})`)
    else {
      loaded.sources.set(key, rel(file))
      loaded.units.push(unit)
    }
  }

  for (const file of listFiles(join(dir, 'lexemes'), '.yaml'))
    loaded.lexemes.push(...parseList(file, Lexeme, 'lexeme'))
  for (const file of listFiles(join(dir, 'sentences'), '.yaml'))
    loaded.sentences.push(...parseList(file, Sentence, 'sentence'))
  for (const file of listFiles(join(dir, 'chats'), '.yaml'))
    loaded.chats.push(...parseList(file, Chat, 'chat'))

  const lettersFile = join(dir, 'letters.yaml')
  if (existsSync(lettersFile)) {
    loaded.letters = parseOne(lettersFile, LettersTrack, readYaml(lettersFile), 'letters')
    for (const l of loaded.letters?.letters ?? []) {
      const key = `letter:${l.id}`
      if (loaded.sources.has(key)) error(lettersFile, `duplicate letter id ${l.id}`)
      else loaded.sources.set(key, rel(lettersFile))
    }
  }

  const charactersFile = join(dir, 'characters.yaml')
  if (existsSync(charactersFile))
    loaded.characters = parseList(charactersFile, Character, 'character')

  const variantsFile = join(dir, 'orthography-variants.yaml')
  if (existsSync(variantsFile)) {
    const raw = readYaml(variantsFile)
    loaded.variants =
      raw == null
        ? []
        : (parseOne(variantsFile, OrthographyVariants, raw, 'orthography variants') ?? [])
  }

  for (const file of listFiles(join(dir, 'guidebooks'), '.md'))
    loaded.guidebooks.set(rel(file), readFileSync(file, 'utf8'))

  const assetsDir = join(dir, 'assets')
  for (const file of walk(assetsDir))
    loaded.assets.set(relative(assetsDir, file).split(sep).join('/'), file)

  return loaded
}

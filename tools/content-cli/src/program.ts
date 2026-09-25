/**
 * zaboon-content: the content pipeline CLI (docs/LEARNING-ENGINE.md §4).
 *
 *   validate · build [--check] · publish --local | --target storage
 *   draft · suggest · art · tts · audio · models check
 *
 * `createProgram(io)` builds the commander program with injectable environment, output and
 * transports, so tests run commands in-process without a network or a key.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Command, InvalidArgumentError } from 'commander'
import type { AiTransport, FetchLike } from '@zaboon/ai'
import { createAiContext, DEFAULT_BUDGET_USD, printDryRun, type AiContext } from './ai-context'
import { processUnitAudio } from './audio'
import { buildCourse, compareBundle, writeBundle } from './build'
import { draftUnit, loadBrief } from './draft'
import { loadCourse } from './load'
import { generateArt, generateTts } from './media'
import { checkModels, formatFindings } from './models'
import { courseDir, localDatabaseUrl, repoRoot, userPath } from './paths'
import { publishLocal } from './publish'
import { publishToStorage, SupabaseStorageUploader, type Uploader } from './storage'
import { suggestVariants } from './suggest'
import { formatIssues, hasErrors, validateCourse } from './validate'

const DEFAULT_COURSE = 'fa-en'

export interface ProgramIO {
  env: NodeJS.ProcessEnv
  out: (line: string) => void
  err: (line: string) => void
  /** Tests: AI calls go to this transport instead of OpenRouter. */
  transport?: AiTransport
  /** Tests: HTTP for `models check`, the key check and storage uploads. */
  fetch?: FetchLike
  /** Tests: storage uploader instead of Supabase. */
  uploader?: Uploader
}

const positiveInt = (v: string): number => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('must be a positive integer')
  return n
}

const positiveUsd = (v: string): number => {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) throw new InvalidArgumentError('must be a positive amount')
  return n
}

const idList = (v: string): string[] =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export function createProgram(io: ProgramIO = defaultIO()): Command {
  const fail = (message: string) => {
    io.err(message)
    process.exitCode = 1
  }
  const aiContext = (budget: number): AiContext =>
    createAiContext({
      env: io.env,
      root: repoRoot(),
      budgetUsd: budget,
      transport: io.transport,
      fetch: io.fetch,
    })

  function runValidate(dir: string, allowDrafts: boolean, label: string): boolean {
    const course = loadCourse(dir)
    const issues = validateCourse(course, { allowDrafts })
    if (issues.length) io.out(formatIssues(issues))
    const counts = `${course.units.length} units, ${course.lexemes.length} lexemes, ${course.sentences.length} sentences, ${course.chats.length} chats, ${course.letters?.letters.length ?? 0} letters`
    if (hasErrors(issues)) {
      io.err(
        `✘ ${label}: ${issues.filter((i) => i.severity === 'error').length} error(s) (${counts})`,
      )
      return false
    }
    io.out(`✔ ${label}: ok (${counts}${allowDrafts ? ', drafts allowed' : ''})`)
    return true
  }

  const program = new Command()
  program.name('zaboon-content').description('Zaboon content pipeline')

  program
    .command('validate')
    .description(
      'Validate a course (default content/fa-en); --fixtures also checks content/fixtures strictly',
    )
    .option('--course <dir|name>', 'course directory or folder name under content/')
    .option('--fixtures', 'also validate content/fixtures (strict: drafts are errors)')
    .option('--allow-drafts', 'allow status: draft items in the course (dev builds only)')
    .action((opts: { course?: string; fixtures?: boolean; allowDrafts?: boolean }) => {
      let ok = true
      const dir = courseDir(opts.course ?? DEFAULT_COURSE)
      if (opts.course || existsSync(join(dir, 'course.yaml'))) {
        ok = runValidate(dir, Boolean(opts.allowDrafts), opts.course ?? DEFAULT_COURSE) && ok
      } else {
        io.out(`- ${DEFAULT_COURSE}: no course content yet (skipped)`)
      }
      if (opts.fixtures)
        ok = runValidate(join(repoRoot(), 'content/fixtures'), false, 'fixtures') && ok
      if (!ok) process.exitCode = 1
    })

  program
    .command('build')
    .description(
      'Compile a course into an immutable bundle: <out>/<courseId>/v<N>/ plus hashed assets',
    )
    .option('--course <dir|name>', 'course directory or folder name under content/', DEFAULT_COURSE)
    .option('--out <dir>', 'output root', '.local/content-build')
    .option('--version <n>', 'bundle version', positiveInt, 1)
    .option('--allow-drafts', 'include status: draft items (dev builds only)')
    .option('--force', 'overwrite an existing v<N>')
    .option('--check', 'write nothing; fail if <out>/<courseId>/v<N> differs from this build')
    .action(
      (opts: {
        course: string
        out: string
        version: number
        allowDrafts?: boolean
        force?: boolean
        check?: boolean
      }) => {
        const bundle = buildCourse(loadCourse(courseDir(opts.course)), {
          version: opts.version,
          allowDrafts: Boolean(opts.allowDrafts),
        })
        if (bundle.warnings.length) io.out(formatIssues(bundle.warnings))
        const out = userPath(opts.out)
        if (opts.check) {
          const target = join(out, bundle.courseId, `v${bundle.version}`)
          if (!existsSync(join(target, 'manifest.json')))
            return fail(`✘ ${target} does not exist; nothing to check against`)
          const diffs = compareBundle(bundle, out)
          if (diffs.length) {
            for (const d of diffs) io.err(`✘ ${d.problem}: ${d.path}`)
            return fail(
              `✘ ${bundle.courseId} v${bundle.version} differs from this build (${diffs.length} file(s))`,
            )
          }
          io.out(`✔ ${bundle.courseId} v${bundle.version} matches the source`)
          return
        }
        const root = writeBundle(bundle, out, { overwrite: Boolean(opts.force) })
        io.out(
          `✔ built ${bundle.courseId} v${bundle.version} → ${root} (${bundle.files.size} files, hash ${bundle.contentHash.slice(0, 12)})`,
        )
      },
    )

  program
    .command('publish')
    .description(
      'Publish a course bundle: --local (web app static folder + local DB) or --target storage',
    )
    .option('--local', 'same as --target local')
    .option('--target <target>', 'local | storage')
    .option('--course <dir|name>', 'course directory or folder name under content/', DEFAULT_COURSE)
    .option('--out <dir>', 'local: static content root', 'apps/web/public/content')
    .option(
      '--database-url <url>',
      'local: app_server connection string (default: DATABASE_URL_APP_SERVER or the local dev DB)',
    )
    .option('--allow-drafts', 'include status: draft items (dev builds only)')
    .option('--no-current', 'local: register the version without making it current')
    .option('--version <n>', 'storage: the version to upload (must be new)', positiveInt)
    .option('--bucket <name>', 'storage: Supabase Storage bucket', 'content')
    .action(
      async (opts: {
        local?: boolean
        target?: string
        course: string
        out: string
        databaseUrl?: string
        allowDrafts?: boolean
        current: boolean
        version?: number
        bucket: string
      }) => {
        const target = opts.target ?? (opts.local ? 'local' : undefined)
        if (target !== 'local' && target !== 'storage')
          return fail('publish needs --local or --target <local|storage>')
        if (target === 'storage') {
          if (!opts.version) return fail('publish --target storage needs --version <n>')
          const uploader = io.uploader ?? SupabaseStorageUploader.fromEnv(io.env, opts.bucket)
          const result = await publishToStorage({
            course: loadCourse(courseDir(opts.course)),
            uploader,
            version: opts.version,
            allowDrafts: Boolean(opts.allowDrafts),
            onUpload: (path, skipped) => io.out(`${skipped ? '=' : '+'} ${path}`),
          })
          io.out(
            `✔ uploaded ${result.bundlePath} (${result.uploaded.length} new, ${result.skipped.length} existing assets reused)`,
          )
          io.out('Register it (release runbook, §4.4). This does NOT make it current:')
          io.out(result.sql)
          return
        }
        const out =
          opts.out === 'apps/web/public/content' ? join(repoRoot(), opts.out) : userPath(opts.out)
        const result = await publishLocal({
          course: loadCourse(courseDir(opts.course)),
          outRoot: out,
          databaseUrl: opts.databaseUrl ?? localDatabaseUrl(),
          allowDrafts: Boolean(opts.allowDrafts),
          makeCurrent: opts.current,
        })
        io.out(
          result.changed
            ? `✔ published ${result.courseId} v${result.version}${opts.current ? ' (current)' : ''} → ${join(out, result.bundlePath)}`
            : `✔ ${result.courseId} unchanged (current is v${result.version})`,
        )
      },
    )

  // --- AI authoring commands ------------------------------------------------------------------
  const aiOptions = (cmd: Command) =>
    cmd
      .option(
        '--course <dir|name>',
        'course directory or folder name under content/',
        DEFAULT_COURSE,
      )
      .option('--dry-run', 'print the prompts and cost estimates; send nothing (no key needed)')
      .option(
        '--budget <usd>',
        `hard cap for the build key's spend recorded in .local/ai-budget.json`,
        positiveUsd,
        DEFAULT_BUDGET_USD,
      )

  aiOptions(
    program
      .command('draft')
      .description('Draft a unit (lexemes, sentences, chats, levels, guidebook) from a unit brief'),
  )
    .requiredOption('--brief <file>', 'unit brief YAML (unit, theme, grammar, vocabulary, …)')
    .option('--force', "replace the unit's existing draft files")
    .option('--batch', 'use the half-price :batch model')
    .option('--write-invalid', 'write the draft even if validation still fails')
    .action(
      async (opts: {
        course: string
        brief: string
        dryRun?: boolean
        budget: number
        force?: boolean
        batch?: boolean
        writeInvalid?: boolean
      }) => {
        const course = loadCourse(courseDir(opts.course))
        const brief = loadBrief(userPath(opts.brief))
        const ai = opts.dryRun ? undefined : aiContext(opts.budget).ai
        const r = await draftUnit({
          course,
          brief,
          ai,
          dryRun: opts.dryRun,
          force: opts.force,
          batch: opts.batch,
          writeInvalid: opts.writeInvalid,
          log: io.out,
        })
        if (r.dryRun) return void printDryRun([r.dryRun], io.out)
        for (const f of r.written) io.out(`+ ${f}`)
        if (r.errors.length) {
          for (const e of r.errors) io.err(`✘ ${e}`)
          return fail(
            r.written.length
              ? `✘ draft written with ${r.errors.length} validation error(s) (--write-invalid)`
              : `✘ draft rejected: ${r.errors.length} validation error(s) remain after the repair round; nothing written`,
          )
        }
        io.out(
          `✔ drafted ${brief.unit} ($${r.costUsd.toFixed(4)}${r.repaired ? ', repaired once' : ''}); review it, then run validate --allow-drafts`,
        )
      },
    )

  aiOptions(
    program
      .command('suggest')
      .description(
        "Suggest accepted-answer variants and word-bank distractors for a unit's sentences",
      ),
  )
    .requiredOption('--unit <id>', 'unit id')
    .option('--ids <ids>', 'only these sentence ids (comma-separated)', idList)
    .option('--out <file>', 'review file (default <course>/suggestions/<unit>.yaml)')
    .option('--force', 'replace an existing review file')
    .option('--batch', 'use the half-price :batch model')
    .action(
      async (opts: {
        course: string
        unit: string
        ids?: string[]
        out?: string
        force?: boolean
        batch?: boolean
        dryRun?: boolean
        budget: number
      }) => {
        const r = await suggestVariants({
          course: loadCourse(courseDir(opts.course)),
          unit: opts.unit,
          ids: opts.ids,
          ai: opts.dryRun ? undefined : aiContext(opts.budget).ai,
          dryRun: opts.dryRun,
          batch: opts.batch,
          out: opts.out ? userPath(opts.out) : undefined,
          force: opts.force,
          log: io.out,
        })
        if (r.dryRun) return void printDryRun([r.dryRun], io.out)
        const dropped = r.suggestions.reduce((n, s) => n + (s.dropped?.length ?? 0), 0)
        io.out(
          `✔ ${r.suggestions.length} suggestion(s) → ${r.file} (${dropped} dropped by checks, $${r.costUsd.toFixed(4)})`,
        )
      },
    )

  aiOptions(
    program
      .command('art')
      .description(
        'Generate a character sheet or an item illustration (GPT Image, with style-bible refs)',
      ),
  )
    .option('--character <id>', 'character id')
    .option('--lexeme <id>', 'lexeme id (select_image illustration)')
    .option('--ref <files...>', 'extra reference images')
    .option('--sheet <text>', 'what to draw (default: turnaround sheet / single object)')
    .option('--force', 'replace existing art')
    .action(
      async (opts: {
        course: string
        character?: string
        lexeme?: string
        ref?: string[]
        sheet?: string
        force?: boolean
        dryRun?: boolean
        budget: number
      }) => {
        if (Boolean(opts.character) === Boolean(opts.lexeme))
          return fail('art needs exactly one of --character <id> or --lexeme <id>')
        const r = await generateArt({
          course: loadCourse(courseDir(opts.course)),
          target: opts.character
            ? { kind: 'character', id: opts.character }
            : { kind: 'lexeme', id: opts.lexeme! },
          ai: opts.dryRun ? undefined : aiContext(opts.budget).ai,
          refs: opts.ref?.map(userPath),
          sheet: opts.sheet,
          dryRun: opts.dryRun,
          force: opts.force,
        })
        if (r.dryRun) return void printDryRun([r.dryRun], io.out)
        io.out(`✔ assets/${r.ref} (+ provenance sidecar; status: draft) $${r.costUsd.toFixed(4)}`)
      },
    )

  aiOptions(
    program
      .command('tts')
      .description("Synthesize draft audio for a unit's sentences (and lexemes)"),
  )
    .requiredOption('--unit <id>', 'unit id')
    .option('--ids <ids>', 'only these ids (comma-separated)', idList)
    .option('--lexemes', "also voice the unit's lexemes")
    .option('--voice <name>', 'voice for speakers without a `voice` (and lexemes)')
    .option('--force', 'regenerate existing TTS clips (never human recordings)')
    .action(
      async (opts: {
        course: string
        unit: string
        ids?: string[]
        lexemes?: boolean
        voice?: string
        force?: boolean
        dryRun?: boolean
        budget: number
      }) => {
        const r = await generateTts({
          course: loadCourse(courseDir(opts.course)),
          unit: opts.unit,
          ids: opts.ids,
          lexemes: opts.lexemes,
          voice: opts.voice,
          ai: opts.dryRun ? undefined : aiContext(opts.budget).ai,
          dryRun: opts.dryRun,
          force: opts.force,
          log: io.out,
        })
        for (const s of r.skipped) io.out(`= ${s.id}: ${s.reason}`)
        if (r.dryRun) return void printDryRun(r.dryRun, io.out)
        io.out(
          `✔ ${r.written.length} clip(s) written ($${r.costUsd.toFixed(4)}); run \`audio --unit ${opts.unit}\` next, then get native sign-off`,
        )
      },
    )

  program
    .command('audio')
    .description(
      'Normalize sentence audio (−16 LUFS mono 64k mp3), render 0.7× clips and envelopes',
    )
    .option('--course <dir|name>', 'course directory or folder name under content/', DEFAULT_COURSE)
    .requiredOption('--unit <id>', 'unit id')
    .option('--ids <ids>', 'only these sentence ids (comma-separated)', idList)
    .option('--force', 'reprocess clips that already have slow + envelope files')
    .action(async (opts: { course: string; unit: string; ids?: string[]; force?: boolean }) => {
      const r = await processUnitAudio({
        course: loadCourse(courseDir(opts.course)),
        unit: opts.unit,
        ids: opts.ids,
        force: opts.force,
        log: io.out,
      })
      for (const s of r.skipped) io.out(`= ${s.id}: ${s.reason}`)
      io.out(`✔ ${r.processed.length} clip(s) processed`)
    })

  program
    .command('models')
    .description('Model registry tools')
    .command('check')
    .description('Flag newer versions of the pinned OpenRouter models (no key needed)')
    .action(async () => {
      const findings = await checkModels({ fetch: io.fetch })
      for (const line of formatFindings(findings)) io.out(line)
      if (findings.some((f) => !f.available)) process.exitCode = 1
    })

  return program
}

export function defaultIO(): ProgramIO {
  return {
    env: process.env,
    out: (line) => console.info(line),
    err: (line) => console.error(line),
  }
}

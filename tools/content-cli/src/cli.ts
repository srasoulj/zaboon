/**
 * zaboon-content: the content pipeline CLI (docs/LEARNING-ENGINE.md §4).
 *
 * Wave 0 ships `validate`, `build` and `publish --local`. ws-content-cli adds
 * draft · suggest · art · tts · audio · models and production `publish`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Command, InvalidArgumentError } from 'commander'
import { buildCourse, writeBundle } from './build'
import { loadCourse } from './load'
import { courseDir, localDatabaseUrl, repoRoot, userPath } from './paths'
import { publishLocal } from './publish'
import { formatIssues, hasErrors, validateCourse } from './validate'

const DEFAULT_COURSE = 'fa-en'

const positiveInt = (v: string): number => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('must be a positive integer')
  return n
}

function runValidate(dir: string, allowDrafts: boolean, label: string): boolean {
  const course = loadCourse(dir)
  const issues = validateCourse(course, { allowDrafts })
  if (issues.length) console.info(formatIssues(issues))
  const counts = `${course.units.length} units, ${course.lexemes.length} lexemes, ${course.sentences.length} sentences, ${course.chats.length} chats, ${course.letters?.letters.length ?? 0} letters`
  if (hasErrors(issues)) {
    console.error(
      `✘ ${label}: ${issues.filter((i) => i.severity === 'error').length} error(s) (${counts})`,
    )
    return false
  }
  console.info(`✔ ${label}: ok (${counts}${allowDrafts ? ', drafts allowed' : ''})`)
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
      console.info(`- ${DEFAULT_COURSE}: no course content yet (skipped)`)
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
  .action(
    (opts: {
      course: string
      out: string
      version: number
      allowDrafts?: boolean
      force?: boolean
    }) => {
      const bundle = buildCourse(loadCourse(courseDir(opts.course)), {
        version: opts.version,
        allowDrafts: Boolean(opts.allowDrafts),
      })
      if (bundle.warnings.length) console.info(formatIssues(bundle.warnings))
      const root = writeBundle(bundle, userPath(opts.out), { overwrite: Boolean(opts.force) })
      console.info(
        `✔ built ${bundle.courseId} v${bundle.version} → ${root} (${bundle.files.size} files, hash ${bundle.contentHash.slice(0, 12)})`,
      )
    },
  )

program
  .command('publish')
  .description(
    'Publish a course bundle (Wave 0: --local only, into apps/web/public/content + the local DB)',
  )
  .requiredOption('--local', 'publish to the local web app and local database')
  .option('--course <dir|name>', 'course directory or folder name under content/', DEFAULT_COURSE)
  .option('--out <dir>', 'static content root', 'apps/web/public/content')
  .option(
    '--database-url <url>',
    'app_server connection string (default: DATABASE_URL_APP_SERVER or the local dev DB)',
  )
  .option('--allow-drafts', 'include status: draft items (dev builds only)')
  .option('--no-current', 'register the version without making it current')
  .action(
    async (opts: {
      course: string
      out: string
      databaseUrl?: string
      allowDrafts?: boolean
      current: boolean
    }) => {
      const out =
        opts.out === 'apps/web/public/content' ? join(repoRoot(), opts.out) : userPath(opts.out)
      const result = await publishLocal({
        course: loadCourse(courseDir(opts.course)),
        outRoot: out,
        databaseUrl: opts.databaseUrl ?? localDatabaseUrl(),
        allowDrafts: Boolean(opts.allowDrafts),
        makeCurrent: opts.current,
      })
      console.info(
        result.changed
          ? `✔ published ${result.courseId} v${result.version}${opts.current ? ' (current)' : ''} → ${join(out, result.bundlePath)}`
          : `✔ ${result.courseId} unchanged (current is v${result.version})`,
      )
    },
  )

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

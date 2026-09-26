/**
 * Release on deploy. Vercel runs this before `next build` on every production build
 * (apps/web/vercel.json `buildCommand` → apps/web/package.json `vercel-build`), so merging to
 * `main` is the whole release (docs/DEPLOY.md §8):
 *
 *   1. Database: applies the supabase/migrations not recorded yet, as the `postgres` role over
 *      DATABASE_URL_MIGRATE, the way `supabase db push` does (scripts/migrations.ts). Migrations
 *      are expand-only (docs/ARCHITECTURE.md §12), so the deployment still live keeps working.
 *   2. Content: builds each course in RELEASE_COURSES and, when its content hash differs from the
 *      current published version's, uploads an immutable `v<N+1>/` to the `content` bucket
 *      (tools/content-cli/src/storage.ts), registers it in content_versions and makes it current.
 *      Unchanged content publishes nothing, so most builds upload nothing.
 *
 * Off production (previews, laptops) it runs only when DATABASE_URL_MIGRATE is set, so a preview
 * build never touches the production database. On production a missing variable fails the build:
 * never a silent deploy against an unmigrated schema.
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { buildCourse, parseBuildInfo } from '../tools/content-cli/src/build'
import { loadCourse, type LoadedCourse } from '../tools/content-cli/src/load'
import {
  PartialUploadError,
  publishToStorage,
  SupabaseStorageUploader,
  VersionExistsError,
  type Uploader,
} from '../tools/content-cli/src/storage'
import { applyMigrations, loadMigrations, type MigrationFile } from './migrations'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The bucket the app reads from (apps/web/lib/content-base-url.ts derives its public URL). */
export const CONTENT_BUCKET = 'content'

export interface ReleaseCourse {
  id: string
  /** Course directory, relative to the repository root. */
  dir: string
  allowDrafts: boolean
}

/**
 * What every production build publishes. Owner decision (docs/DEPLOY.md §4): fa-en ships with its
 * drafts until native-speaker review lands; the versions it publishes record `includes_drafts`.
 */
export const RELEASE_COURSES: readonly ReleaseCourse[] = [
  { id: 'fa-en', dir: 'content/fa-en', allowDrafts: true },
]

/** A half-uploaded or foreign `v<N>/` is skipped this many times before the release gives up. */
const VERSION_TRIES = 10

export interface ReleaseOptions {
  env: NodeJS.ProcessEnv
  migrations?: readonly MigrationFile[]
  courses?: readonly ReleaseCourse[]
  now?: Date
  log?: (line: string) => void
  /** Tests: stand-ins for the database, the bucket and the course source. */
  connect?: (url: string) => postgres.Sql
  uploader?: Uploader
  loadCourse?: (dir: string) => LoadedCourse
}

export interface ContentRelease {
  courseId: string
  /** The current version after the release. */
  version: number
  /** True when this release published `version`. */
  changed: boolean
}

export interface ReleaseResult {
  /** Why nothing ran (no DATABASE_URL_MIGRATE off production); absent when the release ran. */
  skipped?: string
  /** `<version>_<name>` of every migration applied. */
  migrations: string[]
  content: ContentRelease[]
}

function isLoopback(url: string): boolean {
  try {
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}

/** One connection, no prepared statements (fine behind either Supabase pooler), TLS off loopback. */
function defaultConnect(url: string): postgres.Sql {
  const explicitSsl = /[?&]sslmode=/.test(url)
  return postgres(url, {
    max: 1,
    prepare: false,
    onnotice: () => {},
    ...(explicitSsl || isLoopback(url) ? {} : { ssl: 'require' as const }),
  })
}

/** A misconfiguration (printed without a stack trace: the message says what to change). */
export class ReleaseConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReleaseConfigError'
  }
}

function storageFromEnv(env: NodeJS.ProcessEnv): Uploader {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.CONTENT_STORAGE_UPLOAD_KEY || env.SUPABASE_SECRET_KEY
  if (!url || !key)
    throw new ReleaseConfigError(
      'publishing content needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or CONTENT_STORAGE_UPLOAD_KEY) in the environment',
    )
  return new SupabaseStorageUploader({ url, key, bucket: CONTENT_BUCKET })
}

export async function release(opts: ReleaseOptions): Promise<ReleaseResult> {
  const log = opts.log ?? ((line: string) => console.info(line))
  const url = opts.env.DATABASE_URL_MIGRATE
  if (!url) {
    if (opts.env.VERCEL_ENV === 'production')
      throw new ReleaseConfigError(
        'DATABASE_URL_MIGRATE is not set. Production builds apply migrations and publish content with it (docs/DEPLOY.md §3.2): add it to the Vercel project for Production only.',
      )
    const skipped = `DATABASE_URL_MIGRATE is not set (${opts.env.VERCEL_ENV ?? 'not on Vercel'}): nothing to migrate or publish`
    log(`[release] skipped: ${skipped}`)
    return { skipped, migrations: [], content: [] }
  }

  const sql = (opts.connect ?? defaultConnect)(url)
  try {
    const migrations = opts.migrations ?? loadMigrations(join(ROOT, 'supabase', 'migrations'))
    const applied = await applyMigrations(sql, migrations, (line) => log(`[release] ${line}`))
    log(`[release] database: ${applied.length} new migration(s), ${migrations.length} total`)

    const courses = opts.courses ?? RELEASE_COURSES
    const content: ContentRelease[] = []
    if (courses.length > 0) {
      const uploader = opts.uploader ?? storageFromEnv(opts.env)
      for (const course of courses)
        content.push(await publishCourse(sql, uploader, course, opts, log))
    }
    return { migrations: applied, content }
  } finally {
    await sql.end()
  }
}

async function publishCourse(
  sql: postgres.Sql,
  uploader: Uploader,
  course: ReleaseCourse,
  opts: ReleaseOptions,
  log: (line: string) => void,
): Promise<ContentRelease> {
  const source = (opts.loadCourse ?? loadCourse)(resolve(ROOT, course.dir))
  // Build first: content errors fail the release before the bucket or the database is touched.
  const probe = buildCourse(source, { version: 1, allowDrafts: course.allowDrafts, now: opts.now })
  const courseId = probe.courseId
  if (courseId !== course.id)
    throw new Error(
      `${course.dir} is course "${courseId}", not "${course.id}" (scripts/release.ts)`,
    )

  const rows = await sql<{ version: number; bundle_path: string; is_current: boolean }[]>`
    SELECT version, bundle_path, is_current FROM public.content_versions
    WHERE course_id = ${courseId} ORDER BY version DESC`
  const current = rows.find((r) => r.is_current)
  if (current) {
    const info = parseBuildInfo(await uploader.read(`${current.bundle_path}/build-info.json`))
    if (info?.contentHash === probe.contentHash) {
      log(`[release] content: ${courseId} unchanged (current is v${current.version})`)
      return { courseId, version: current.version, changed: false }
    }
    if (!info)
      log(
        `[release] content: ${current.bundle_path}/build-info.json is missing from the bucket; publishing ${courseId} again`,
      )
  }

  // The next version number; a `v<N>/` someone else published, or a failed upload left behind, is
  // skipped rather than touched (versions are immutable).
  let version = (rows[0]?.version ?? 0) + 1
  const lastTry = version + VERSION_TRIES - 1
  let published
  for (;;) {
    try {
      published = await publishToStorage({
        course: source,
        uploader,
        version,
        allowDrafts: course.allowDrafts,
        now: opts.now,
      })
      break
    } catch (err) {
      const skippable = err instanceof VersionExistsError || err instanceof PartialUploadError
      if (!skippable || version >= lastTry) throw err
      log(`[release] content: ${err.message}; trying v${version + 1}`)
      version++
    }
  }

  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`zaboon:content-publish:${courseId}`}, 0))`
    await tx`INSERT INTO public.content_versions (course_id, version, bundle_path, includes_drafts, is_current)
             VALUES (${courseId}, ${published.version}, ${published.bundlePath}, ${published.includesDrafts}, false)
             ON CONFLICT DO NOTHING`
    await tx`UPDATE public.content_versions SET is_current = false
             WHERE course_id = ${courseId} AND is_current AND version <> ${published.version}`
    await tx`UPDATE public.content_versions SET is_current = true
             WHERE course_id = ${courseId} AND version = ${published.version}`
  })
  log(
    `[release] content: published ${published.bundlePath} (${published.uploaded.length} files uploaded, ${published.skipped.length} assets reused), now current${published.includesDrafts ? ', includes drafts' : ''}`,
  )
  return { courseId, version: published.version, changed: true }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  release({ env: process.env }).catch((err: unknown) => {
    console.error('[release] failed:', err instanceof ReleaseConfigError ? err.message : err)
    process.exit(1)
  })
}

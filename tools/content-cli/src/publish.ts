/**
 * `publish --local`: builds a course into the web app's static folder and registers the version
 * in the local database's `content_versions` (LEARNING-ENGINE §4.3; production publishing to
 * Storage is ws-content-cli's). Local publishes also mark the version current, because there is
 * no staging step on a laptop.
 *
 * Idempotent: when the current version's build-info hash matches the new build, nothing changes.
 * A transaction-scoped advisory lock serializes concurrent publishes of the same course.
 */
import { join } from 'node:path'
import { and, desc, eq, sql } from 'drizzle-orm'
import { createDb, schema, withSystem } from '@zaboon/db'
import { buildCourse, readBuildInfo, writeBundle } from './build'
import type { LoadedCourse } from './load'

export interface PublishLocalOptions {
  course: LoadedCourse
  /** Static root served at /content (default apps/web/public/content). */
  outRoot: string
  databaseUrl: string
  allowDrafts: boolean
  makeCurrent: boolean
  now?: Date
}

export interface PublishResult {
  courseId: string
  version: number
  changed: boolean
  /** Stored in content_versions.bundle_path: "<courseId>/v<N>" relative to the content base URL. */
  bundlePath: string
}

export async function publishLocal(opts: PublishLocalOptions): Promise<PublishResult> {
  // Build once up front: validation errors surface before touching the database.
  const probe = buildCourse(opts.course, {
    version: 1,
    allowDrafts: opts.allowDrafts,
    now: opts.now,
  })
  const courseId = probe.courseId
  const handle = createDb(opts.databaseUrl, { max: 1 })
  try {
    return await withSystem(handle.db, async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`zaboon:content-publish:${courseId}`}, 0))`,
      )
      const rows = await tx
        .select()
        .from(schema.contentVersions)
        .where(eq(schema.contentVersions.courseId, courseId))
        .orderBy(desc(schema.contentVersions.version))
      const current = rows.find((r) => r.isCurrent)
      if (current) {
        const info = readBuildInfo(join(opts.outRoot, current.bundlePath))
        if (info?.contentHash === probe.contentHash) {
          return {
            courseId,
            version: current.version,
            changed: false,
            bundlePath: current.bundlePath,
          }
        }
      }
      const version = (rows[0]?.version ?? 0) + 1
      const bundle =
        version === 1
          ? probe
          : buildCourse(opts.course, { version, allowDrafts: opts.allowDrafts, now: opts.now })
      writeBundle(bundle, opts.outRoot, { overwrite: true })
      const bundlePath = `${courseId}/v${version}`
      if (opts.makeCurrent) {
        await tx
          .update(schema.contentVersions)
          .set({ isCurrent: false })
          .where(
            and(
              eq(schema.contentVersions.courseId, courseId),
              eq(schema.contentVersions.isCurrent, true),
            ),
          )
      }
      await tx.insert(schema.contentVersions).values({
        courseId,
        version,
        bundlePath,
        includesDrafts: bundle.includesDrafts,
        isCurrent: opts.makeCurrent,
      })
      return { courseId, version, changed: true, bundlePath }
    })
  } finally {
    await handle.close()
  }
}

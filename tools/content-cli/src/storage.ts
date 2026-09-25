/**
 * `publish --target storage` (LEARNING-ENGINE §4.3–§4.4): uploads an immutable `v<N>/` and any
 * new content-hashed assets through an `Uploader`, then prints the `content_versions` INSERT for
 * the release runbook. It never makes the version current: that is a separate, approved step.
 *
 * Upload order: assets first (skipped when present: their names are content hashes), then the
 * version's files, and `manifest.json` last, so a version counts as published only once its
 * manifest exists. Version files are never overwritten: a failed run leaves a partial `v<N>/`
 * that must be removed (or a new version picked) before retrying.
 */
import { buildCourse, type BuiltBundle } from './build'
import type { LoadedCourse } from './load'

export interface UploadOptions {
  contentType: string
  cacheControl: string
}

export interface Uploader {
  /** True when an object exists at `path` (relative to the bucket root). */
  exists(path: string): Promise<boolean>
  /** Creates the object; must fail rather than overwrite an existing one. */
  upload(path: string, bytes: Buffer, opts: UploadOptions): Promise<void>
}

export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  webp: 'image/webp',
  png: 'image/png',
  svg: 'image/svg+xml',
  riv: 'application/octet-stream',
}

export function contentTypeFor(path: string): string {
  return (
    CONTENT_TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'
  )
}

/** In-memory uploader for tests and dry runs. */
export class MemoryUploader implements Uploader {
  readonly objects = new Map<string, { bytes: Buffer } & UploadOptions>()
  readonly log: string[] = []
  async exists(path: string): Promise<boolean> {
    return this.objects.has(path)
  }
  async upload(path: string, bytes: Buffer, opts: UploadOptions): Promise<void> {
    if (this.objects.has(path)) throw new Error(`object already exists: ${path}`)
    this.objects.set(path, { bytes, ...opts })
    this.log.push(path)
  }
}

export interface SupabaseStorageOptions {
  /** Project URL, e.g. https://<ref>.supabase.co */
  url: string
  /** A key allowed to write to the content bucket (CONTENT_STORAGE_UPLOAD_KEY). */
  key: string
  bucket: string
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
}

/** Supabase Storage REST API (`/storage/v1/object/<bucket>/<path>`). */
export class SupabaseStorageUploader implements Uploader {
  private readonly base: string
  private readonly fetchImpl: NonNullable<SupabaseStorageOptions['fetch']>

  constructor(private readonly opts: SupabaseStorageOptions) {
    if (!opts.url || !opts.key) throw new Error('SupabaseStorageUploader needs a url and a key')
    this.base = `${opts.url.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(opts.bucket)}`
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init))
  }

  /** Reads SUPABASE_URL and CONTENT_STORAGE_UPLOAD_KEY; refuses to run without them. */
  static fromEnv(env: NodeJS.ProcessEnv, bucket: string): SupabaseStorageUploader {
    const url = env.SUPABASE_URL
    const key = env.CONTENT_STORAGE_UPLOAD_KEY
    const missing = [!url && 'SUPABASE_URL', !key && 'CONTENT_STORAGE_UPLOAD_KEY'].filter(Boolean)
    if (missing.length)
      throw new Error(`publish --target storage needs ${missing.join(' and ')} in the environment`)
    return new SupabaseStorageUploader({ url: url!, key: key!, bucket })
  }

  private objectUrl(path: string): string {
    return `${this.base}/${path.split('/').map(encodeURIComponent).join('/')}`
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.opts.key}`, apikey: this.opts.key }
  }

  async exists(path: string): Promise<boolean> {
    const res = await this.fetchImpl(this.objectUrl(path), {
      method: 'HEAD',
      headers: this.headers(),
    })
    if (res.ok) return true
    if (res.status === 400 || res.status === 404) return false
    throw new Error(`storage HEAD ${path}: HTTP ${res.status}`)
  }

  async upload(path: string, bytes: Buffer, opts: UploadOptions): Promise<void> {
    const res = await this.fetchImpl(this.objectUrl(path), {
      method: 'POST',
      headers: {
        ...this.headers(),
        'Content-Type': opts.contentType,
        'Cache-Control': opts.cacheControl,
        'x-upsert': 'false',
      },
      body: new Uint8Array(bytes),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`storage upload ${path}: HTTP ${res.status} ${body.slice(0, 200)}`)
    }
  }
}

const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`

/** The row the release runbook inserts after a storage publish (never current here). */
export function contentVersionInsertSql(row: {
  courseId: string
  version: number
  bundlePath: string
  includesDrafts: boolean
}): string {
  return (
    'INSERT INTO public.content_versions (course_id, version, bundle_path, includes_drafts, is_current) ' +
    `VALUES (${sqlString(row.courseId)}, ${row.version}, ${sqlString(row.bundlePath)}, ${row.includesDrafts}, false);`
  )
}

export interface StoragePublishOptions {
  course: LoadedCourse
  uploader: Uploader
  version: number
  allowDrafts: boolean
  now?: Date
  /** Called after each object, for progress output. */
  onUpload?: (path: string, skipped: boolean) => void
}

export interface StoragePublishResult {
  courseId: string
  version: number
  bundlePath: string
  contentHash: string
  includesDrafts: boolean
  uploaded: string[]
  skipped: string[]
  sql: string
}

export async function publishToStorage(opts: StoragePublishOptions): Promise<StoragePublishResult> {
  const bundle: BuiltBundle = buildCourse(opts.course, {
    version: opts.version,
    allowDrafts: opts.allowDrafts,
    now: opts.now,
  })
  const courseId = bundle.courseId
  const bundlePath = `${courseId}/v${bundle.version}`
  if (await opts.uploader.exists(`${bundlePath}/manifest.json`))
    throw new Error(
      `${bundlePath} is already published; versions are immutable (pick a new --version)`,
    )

  const uploaded: string[] = []
  const skipped: string[] = []
  const put = async (rel: string, bytes: Buffer, skipIfPresent: boolean) => {
    const path = `${courseId}/${rel}`
    if (skipIfPresent && (await opts.uploader.exists(path))) {
      skipped.push(path)
      opts.onUpload?.(path, true)
      return
    }
    await opts.uploader.upload(path, bytes, {
      contentType: contentTypeFor(rel),
      cacheControl: IMMUTABLE_CACHE,
    })
    uploaded.push(path)
    opts.onUpload?.(path, false)
  }

  const entries = [...bundle.files].sort(([a], [b]) => a.localeCompare(b))
  const manifest = `v${bundle.version}/manifest.json`
  for (const [rel, bytes] of entries) if (rel.startsWith('assets/')) await put(rel, bytes, true)
  for (const [rel, bytes] of entries) {
    if (rel.startsWith('assets/') || rel === manifest) continue
    if (await opts.uploader.exists(`${courseId}/${rel}`))
      throw new Error(
        `${courseId}/${rel} exists but ${bundlePath} has no manifest: a partial upload from a failed run. Remove ${bundlePath}/ from the bucket or pick a new --version.`,
      )
    await put(rel, bytes, false)
  }
  await put(manifest, bundle.files.get(manifest)!, false)

  return {
    courseId,
    version: bundle.version,
    bundlePath,
    contentHash: bundle.contentHash,
    includesDrafts: bundle.includesDrafts,
    uploaded,
    skipped,
    sql: contentVersionInsertSql({
      courseId,
      version: bundle.version,
      bundlePath,
      includesDrafts: bundle.includesDrafts,
    }),
  }
}

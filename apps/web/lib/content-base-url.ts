/**
 * Where published course content lives: CONTENT_BASE_URL when set, otherwise the Supabase
 * project's public `content` bucket, which is where the release publishes (scripts/release.ts).
 * Empty when neither is configured: same-origin `/content/…` only, as in local mode
 * (apps/web/public/content). Read at build time (next.config.ts inlines the same rule, the
 * service-worker route) and at runtime (lib/server/env.ts).
 */
export function contentBaseUrlFromEnv(env: Record<string, string | undefined>): string {
  if (env.CONTENT_BASE_URL) return env.CONTENT_BASE_URL
  const supabase = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  return supabase ? `${supabase}/storage/v1/object/public/content` : ''
}

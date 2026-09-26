import type { NextConfig } from 'next'

// Orchestrator-owned (CLAUDE.md). Dev-auth route files (`route.dev.ts`) are compiled in only when
// ZABOON_DEV_AUTH=1 at build/dev-server start (ADR 0009); production builds never contain them.
const devAuth = process.env.ZABOON_DEV_AUTH === '1'

// The browser plays course media only from the content origin (components/path/play-audio.ts).
// One source of truth, inlined at build time: CONTENT_BASE_URL, else the Supabase project's public
// `content` bucket, where the release publishes (scripts/release.ts); '' = same-origin `/content/…`
// only, as in local mode. The same rule as lib/content-base-url.ts, repeated here because this
// file loads outside the app's module graph; next-config.test.ts keeps the two in step.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
const contentBaseUrl =
  process.env.CONTENT_BASE_URL ||
  (supabaseUrl ? `${supabaseUrl}/storage/v1/object/public/content` : '')

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev-tools badge overlaps the mobile tab bar (and e2e clicks).
  devIndicators: false,
  pageExtensions: ['tsx', 'ts', 'jsx', 'js', ...(devAuth ? ['dev.tsx', 'dev.ts'] : [])],
  // Playwright and local tools reach the dev server via 127.0.0.1.
  allowedDevOrigins: ['127.0.0.1'],
  transpilePackages: [
    '@zaboon/ai',
    '@zaboon/content-schema',
    '@zaboon/contracts',
    '@zaboon/db',
    '@zaboon/farsi',
    '@zaboon/game-rules',
    '@zaboon/grader',
    '@zaboon/session-engine',
    '@zaboon/srs',
    '@zaboon/ui',
  ],
  // Postgres drivers stay server-side Node modules; esbuild(-wasm) bundles the Serwist service
  // worker at request/build time (this is all `withSerwist` from @serwist/turbopack adds).
  serverExternalPackages: ['postgres', 'esbuild', 'esbuild-wasm'],
  env: { NEXT_PUBLIC_CONTENT_BASE_URL: contentBaseUrl },
}

export default nextConfig

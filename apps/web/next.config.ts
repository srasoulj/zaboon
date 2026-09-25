import type { NextConfig } from 'next'

// Orchestrator-owned (CLAUDE.md). Dev-auth route files (`route.dev.ts`) are compiled in only when
// ZABOON_DEV_AUTH=1 at build/dev-server start (ADR 0009); production builds never contain them.
const devAuth = process.env.ZABOON_DEV_AUTH === '1'

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
  // Postgres drivers stay server-side Node modules.
  serverExternalPackages: ['postgres'],
}

export default nextConfig

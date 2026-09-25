import type { NextConfig } from 'next'

// Wave 0a skeleton. Wave 0b makes this the final, orchestrator-owned config
// (transpilePackages, dev-auth pageExtensions, headers).
const nextConfig: NextConfig = {
  reactStrictMode: true,
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
}

export default nextConfig

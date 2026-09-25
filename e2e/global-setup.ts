/**
 * Orchestrator-owned: makes sure the local database is up and both courses are published before
 * any spec runs. `publish --local` is idempotent, so reruns are cheap.
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export default function globalSetup(): void {
  const run = (cmd: string, args: string[]) =>
    execFileSync(cmd, args, { cwd: root, stdio: 'inherit' })
  run('bash', ['scripts/db-local.sh', 'ensure'])
  run('pnpm', ['-s', 'content', 'publish', '--local', '--course', 'fixtures'])
  run('pnpm', ['-s', 'content', 'publish', '--local', '--course', 'fa-en', '--allow-drafts'])
}

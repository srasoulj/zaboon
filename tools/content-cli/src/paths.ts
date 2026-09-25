/** Path helpers: pnpm runs scripts inside the package, so user paths resolve from INIT_CWD. */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export function repoRoot(from: string = process.cwd()): string {
  let dir = resolve(from)
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error('could not find the repository root (pnpm-workspace.yaml)')
    dir = parent
  }
  return dir
}

/** The directory the user ran the command from. */
export function userCwd(): string {
  return process.env.INIT_CWD ?? process.cwd()
}

export function userPath(p: string): string {
  return isAbsolute(p) ? p : resolve(userCwd(), p)
}

/** `--course` accepts a directory or a course folder name under content/ (e.g. "fixtures", "fa-en"). */
export function courseDir(nameOrPath: string): string {
  const asPath = userPath(nameOrPath)
  if (existsSync(join(asPath, 'course.yaml'))) return asPath
  return join(repoRoot(), 'content', nameOrPath)
}

/** The local app_server URL printed by scripts/db-local.sh (single source of the dev credential). */
export function localDatabaseUrl(): string {
  if (process.env.DATABASE_URL_APP_SERVER) return process.env.DATABASE_URL_APP_SERVER
  return execFileSync('bash', [join(repoRoot(), 'scripts/db-local.sh'), 'url'], {
    encoding: 'utf8',
  }).trim()
}

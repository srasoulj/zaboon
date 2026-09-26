/**
 * Path-ownership gate for parallel workstreams (ops/ownership.json).
 *   pnpm ownership --base origin/main --branch claude/zaboon-ws-db
 * Workstream is taken from the branch name `claude/zaboon-<ws>[-suffix]`; orchestrator branches may
 * touch anything. Fails if a changed file is protected or outside the workstream's paths.
 * A workstream path starting with `!` excludes what it matches (e.g. a file handed to a later wave).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

interface Ownership {
  orchestratorBranches: string[]
  alwaysAllowed: string[]
  protected: string[]
  workstreams: Record<string, { wave: number; paths: string[] }>
}

export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else re += '[^/]*'
    } else if ('.+^${}()|[]\\'.includes(c)) re += `\\${c}`
    else re += c
  }
  return new RegExp(`^${re}$`)
}

export function matchesAny(file: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(file))
}

/** True when a workstream owns `file`: some path matches and no `!` exclusion does. */
export function owns(file: string, paths: readonly string[]): boolean {
  const include = paths.filter((p) => !p.startsWith('!'))
  const exclude = paths.filter((p) => p.startsWith('!')).map((p) => p.slice(1))
  return matchesAny(file, include) && !matchesAny(file, exclude)
}

export function workstreamFor(branch: string, own: Ownership): string | null {
  const m = /^claude\/zaboon-(ws-[a-z0-9-]+?)(?:-\d+)?$/.exec(branch)
  if (!m) return null
  const id = m[1]!
  if (own.workstreams[id]) return id
  // allow suffixed branches such as ws-qa-3 → ws-qa
  const base = Object.keys(own.workstreams).find((k) => id.startsWith(`${k}-`))
  return base ?? null
}

export function check(files: readonly string[], branch: string, own: Ownership): string[] {
  if (own.orchestratorBranches.includes(branch)) return []
  const ws = workstreamFor(branch, own)
  if (!ws) return [`branch ${branch} is not a known workstream branch (claude/zaboon-<ws>)`]
  const allowed = own.workstreams[ws]!.paths
  const problems: string[] = []
  for (const f of files) {
    if (matchesAny(f, own.alwaysAllowed)) continue
    if (matchesAny(f, own.protected)) problems.push(`${f}: protected (orchestrator-owned)`)
    else if (!owns(f, allowed)) problems.push(`${f}: outside ${ws} paths`)
  }
  return problems
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

if (process.argv[1]?.endsWith('check-ownership.ts')) {
  const own = JSON.parse(
    readFileSync(new URL('../ops/ownership.json', import.meta.url), 'utf8'),
  ) as Ownership
  const base = arg('base') ?? 'origin/main'
  const branch =
    arg('branch') ??
    execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()
  // Diff the named branch (not HEAD), so the orchestrator can check a worker branch it hasn't checked out.
  const ref = arg('branch') ?? 'HEAD'
  const files = execFileSync('git', ['diff', '--name-only', `${base}...${ref}`], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
  const problems = check(files, branch, own)
  if (problems.length) {
    console.error(`ownership: ${problems.length} problem(s) on ${branch}:`)
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.info(`ownership: ok (${files.length} changed file(s) on ${branch})`)
}

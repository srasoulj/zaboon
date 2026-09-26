/**
 * GitHub Actions hygiene: no `run:` script interpolates a `${{ … }}` expression. Values such as a
 * PR's branch name are chosen by whoever opens the PR, and an expression is pasted into the script
 * before the shell runs it (script injection). Pass them through `env:` and quote the variable.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const DIR = new URL('../.github/workflows/', import.meta.url)

/** The `run:` scripts of a workflow: one-line values and `|` / `>` block scalars. */
function runScripts(yaml: string): string[] {
  const lines = yaml.split('\n')
  const scripts: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]!)
    if (!m) continue
    const indent = m[1]!.length
    if (!/^[|>][-+]?\s*$/.test(m[2]!)) {
      scripts.push(m[2]!)
      continue
    }
    const block: string[] = []
    while (i + 1 < lines.length) {
      const next = lines[i + 1]!
      if (next.trim() !== '' && next.search(/\S/) <= indent) break
      block.push(next.trim())
      i++
    }
    scripts.push(block.join('\n').trim())
  }
  return scripts
}

const workflows = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f))

describe('GitHub workflows', () => {
  it('reads one-line and block run scripts', () => {
    const yaml = [
      'steps:',
      '  - run: echo "${{ github.head_ref }}"',
      '  - name: block',
      '    run: |',
      '      echo a',
      '',
      '      echo ${{ github.event.pull_request.title }}',
      '  - name: env',
      '    env:',
      '      HEAD_REF: ${{ github.head_ref }}',
      '    run: echo "$HEAD_REF"',
    ].join('\n')
    expect(runScripts(yaml)).toEqual([
      'echo "${{ github.head_ref }}"',
      'echo a\n\necho ${{ github.event.pull_request.title }}',
      'echo "$HEAD_REF"',
    ])
  })

  it('finds the CI workflow and its scripts', () => {
    expect(workflows).toContain('ci.yml')
    const ci = runScripts(readFileSync(new URL('ci.yml', DIR), 'utf8'))
    expect(ci).toContain('pnpm ownership --base "origin/$BASE_REF" --branch "$HEAD_REF"')
  })

  it.each(workflows)('%s: no run script interpolates an expression', (file) => {
    const scripts = runScripts(readFileSync(new URL(file, DIR), 'utf8'))
    expect(scripts.filter((s) => s.includes('${{'))).toEqual([])
  })
})

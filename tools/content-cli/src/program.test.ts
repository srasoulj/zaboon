import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { chatResponse, MockTransport, type OpenRouterModel } from '@zaboon/ai'
import { goodDraft } from './fixtures/draft-u02'
import { repoRoot } from './paths'
import { createProgram, type ProgramIO } from './program'
import { MemoryUploader } from './storage'
import { TEST_KEY } from './fixtures/test-key'

const dirs: string[] = []
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'zaboon-cli-'))
  dirs.push(d)
  return d
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
afterEach(() => {
  process.exitCode = undefined
})

const FIXTURES = join(repoRoot(), 'content/fixtures')

/** Runs one CLI command in-process; returns its output and exit code. */
async function run(args: string[], io: Partial<ProgramIO> = {}) {
  const out: string[] = []
  const err: string[] = []
  await createProgram({
    env: {},
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    aiRoot: temp(),
    ...io,
  }).parseAsync(['node', 'zaboon-content', ...args])
  const code = process.exitCode ?? 0
  process.exitCode = undefined
  return { out: out.join('\n'), err: err.join('\n'), code }
}

function seedCopy(): string {
  const dir = join(temp(), 'fa-en')
  cpSync(join(repoRoot(), 'content/fa-en'), dir, { recursive: true })
  return dir
}

function briefFile(): string {
  const file = join(temp(), 'brief.yaml')
  writeFileSync(file, 'unit: u02-about-me\ntheme: Where are you from\nlevels: 1\n')
  return file
}

describe('CLI: AI commands', () => {
  it('refuse to run without OPENROUTER_API_KEY_BUILD', async () => {
    await expect(run(['draft', '--course', seedCopy(), '--brief', briefFile()])).rejects.toThrow(
      /OPENROUTER_API_KEY_BUILD is not set/,
    )
    await expect(run(['tts', '--course', seedCopy(), '--unit', 'u01-hello'])).rejects.toThrow(
      /OPENROUTER_API_KEY_BUILD/,
    )
    await expect(run(['suggest', '--course', seedCopy(), '--unit', 'u01-hello'])).rejects.toThrow(
      /OPENROUTER_API_KEY_BUILD/,
    )
    await expect(run(['art', '--course', seedCopy(), '--lexeme', 'lx_chay'])).rejects.toThrow(
      /OPENROUTER_API_KEY_BUILD/,
    )
  })

  it('--dry-run prints prompts and cost estimates without a key', async () => {
    const r = await run(['draft', '--course', seedCopy(), '--brief', briefFile(), '--dry-run'])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/── draft u02-about-me · openai\/gpt-6-astra/)
    expect(r.out).toMatch(/dry run: 1 call\(s\), estimated at most \$\d+\.\d{4}; nothing was sent/)
    const tts = await run([
      'tts',
      '--course',
      seedCopy(),
      '--unit',
      'u01-hello',
      '--ids',
      's_u01_0001,s_u01_0002',
      '--dry-run',
    ])
    expect(tts.out).toContain('dry run: 2 call(s)')
    const art = await run([
      'art',
      '--course',
      seedCopy(),
      '--character',
      'shirin',
      '--dry-run',
      '--sheet',
      'expression sheet',
    ])
    expect(art.out).toContain('expression sheet')
  })

  it('draft writes a unit with the key from the environment and a mocked model', async () => {
    const dir = seedCopy()
    const transport = new MockTransport(() =>
      chatResponse(JSON.stringify(goodDraft()), { cost: 0.02 }),
    )
    const env = { OPENROUTER_API_KEY_BUILD: TEST_KEY }
    const r = await run(['draft', '--course', dir, '--brief', briefFile()], { env, transport })
    expect(r.code).toBe(0)
    expect(r.out).toContain('+ sentences/u02-about-me.yaml')
    expect(r.out).toContain('✔ drafted u02-about-me ($0.0200)')
    expect(transport.calls[0]!.model).toBe('openai/gpt-6-astra')
    const batch = await run(
      ['draft', '--course', dir, '--brief', briefFile(), '--force', '--batch'],
      { env, transport },
    )
    expect(batch.code).toBe(0)
    expect(transport.calls[1]!.model).toBe('openai/gpt-6-astra:batch')
    const validate = await run(['validate', '--course', dir, '--allow-drafts'])
    expect(validate.code).toBe(0)
  })

  it('art needs exactly one target', async () => {
    const r = await run(['art', '--course', seedCopy(), '--dry-run'])
    expect([r.code, r.err]).toEqual([
      1,
      'art needs exactly one of --character <id> or --lexeme <id>',
    ])
  })
})

describe('CLI: build, publish, audio, models', () => {
  it('build --check passes on an unchanged version and fails on a changed one', async () => {
    const out = temp()
    expect((await run(['build', '--course', FIXTURES, '--out', out, '--version', '2'])).code).toBe(
      0,
    )
    const ok = await run(['build', '--course', FIXTURES, '--out', out, '--version', '2', '--check'])
    expect([ok.code, ok.out]).toEqual([0, '✔ fixture v2 matches the source'])
    writeFileSync(join(out, 'fixture/v2/letters.json'), '{}')
    const bad = await run([
      'build',
      '--course',
      FIXTURES,
      '--out',
      out,
      '--version',
      '2',
      '--check',
    ])
    expect(bad.code).toBe(1)
    expect(bad.err).toContain('✘ changed: v2/letters.json')
    const none = await run([
      'build',
      '--course',
      FIXTURES,
      '--out',
      out,
      '--version',
      '7',
      '--check',
    ])
    expect([none.code, none.err]).toEqual([
      1,
      `✘ ${join(out, 'fixture/v7')} does not exist; nothing to check against`,
    ])
    expect(existsSync(join(out, 'fixture/v7'))).toBe(false)
  })

  it('publish --target storage uploads and prints the INSERT, never making it current', async () => {
    const uploader = new MemoryUploader()
    const r = await run(
      ['publish', '--target', 'storage', '--course', FIXTURES, '--version', '3'],
      { uploader },
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain('+ fixture/v3/manifest.json')
    expect(r.out).toContain('does NOT make it current')
    expect(r.out).toContain("VALUES ('fixture', 3, 'fixture/v3', false, false);")
    const again = await run(['publish', '--target', 'storage', '--course', FIXTURES], { uploader })
    expect([again.code, again.err]).toEqual([1, 'publish --target storage needs --version <n>'])
    const none = await run(['publish', '--course', FIXTURES])
    expect([none.code, none.err]).toEqual([1, 'publish needs --local or --target <local|storage>'])
    await expect(
      run(['publish', '--target', 'storage', '--course', FIXTURES, '--version', '4']),
    ).rejects.toThrow(/SUPABASE_URL/)
  })

  it('audio reports what it processed and skipped', async () => {
    const r = await run([
      'audio',
      '--course',
      seedCopy(),
      '--unit',
      'u01-hello',
      '--ids',
      's_u01_0001',
    ])
    expect(r.out).toBe('= s_u01_0001: no audio.normal file\n✔ 0 clip(s) processed')
  })

  it('models check reads the public list without a key', async () => {
    const recorded = JSON.parse(
      readFileSync(join(__dirname, 'fixtures/openrouter-models.recorded.json'), 'utf8'),
    ) as {
      data: OpenRouterModel[]
    }
    const r = await run(['models', 'check'], {
      fetch: async () => new Response(JSON.stringify({ data: recorded.data })),
    })
    expect(r.code).toBe(0)
    expect(r.out.split('\n')).toHaveLength(7)
    const gone = await run(['models', 'check'], {
      fetch: async () => new Response(JSON.stringify({ data: [] })),
    })
    expect(gone.code).toBe(1)
  })
})

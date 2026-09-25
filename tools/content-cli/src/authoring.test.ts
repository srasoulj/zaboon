import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import {
  AiClient,
  chatResponse,
  MockTransport,
  toDataUrl,
  type ChatRequest,
  type ContentPart,
} from '@zaboon/ai'
import type { FfmpegRunner } from './audio'
import { loadCourse } from './load'
import { generateArt, generateTts, readSidecar } from './media'
import { suggestVariants, type SuggestOutput } from './suggest'
import { mediaRefs, validateCourse } from './validate'
import { setItemFields } from './yaml-out'
import { seedCourseWithoutMedia } from './fixtures/seed'
import { TEST_KEY } from './fixtures/test-key'

const dirs: string[] = []
/** content/fa-en without generated audio and illustrations (the live course may have some). */
function seedCopy(): string {
  const root = mkdtempSync(join(tmpdir(), 'zaboon-authoring-'))
  dirs.push(root)
  return seedCourseWithoutMedia(root)
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(40, 7),
])
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(24, 3),
])
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 1)])
/** 16-bit PCM, what gpt-audio streams (speech() returns it as a WAV). */
const PCM = Buffer.from([0, 0, 0x10, 0x27, 0xf0, 0xd8, 0, 0])
const ai = (respond: (req: ChatRequest) => ReturnType<typeof chatResponse>) => {
  const transport = new MockTransport(respond)
  return { transport, ai: new AiClient({ apiKey: TEST_KEY, transport }) }
}
const errorsOf = (dir: string) =>
  validateCourse(loadCourse(dir), { allowDrafts: true })
    .filter((i) => i.severity === 'error')
    .map((i) => `${i.file}: ${i.message}`)

describe('suggest', () => {
  const answer: SuggestOutput = {
    items: [
      {
        id: 's_u01_0003',
        en: ['Thanks a lot', '[Thanks/Thank you]', '[Thanks'],
        faAccept: ['مرسی!', 'سپاس'],
        distractorsEn: ['Hello', 'Thank', 'you'],
        distractorsFa: ['سلام', 'ممنون'],
        notes: 'سپاس is formal-literary; reviewer to decide.',
      },
      { id: 's_nope', en: [], faAccept: [], distractorsEn: [], distractorsFa: [], notes: '' },
    ],
  }

  it('writes checked suggestions for review: compiling, new patterns and safe tiles only', async () => {
    const dir = seedCopy()
    const { ai: client, transport } = ai(() => chatResponse(JSON.stringify(answer)))
    const r = await suggestVariants({
      course: loadCourse(dir),
      unit: 'u01-hello',
      ids: ['s_u01_0003'],
      ai: client,
      now: new Date('2026-09-25T00:00:00Z'),
    })
    expect(r.file).toBe(join(dir, 'suggestions/u01-hello.yaml'))
    const [s] = r.suggestions
    expect(s).toMatchObject({
      sentence: 's_u01_0003',
      en: ['Thanks a lot'],
      faAccept: ['سپاس'],
      bankDistractors: { en: ['Hello'], fa: ['سلام'] },
      status: 'draft',
      provenance: { model: 'openai/gpt-6-astra', prompt: 'suggest-variants@1' },
    })
    expect(s!.dropped).toEqual([
      'en "[Thanks/Thank you]": already accepted',
      expect.stringMatching(/^en "\[Thanks": does not compile/),
      'fa "مرسی!": already accepted',
      'en tile "Thank": can complete an accepted answer',
      'en tile "you": can complete an accepted answer',
      'fa tile "ممنون": can complete an accepted answer',
    ])
    expect(r.suggestions).toHaveLength(1)
    const file = parseYaml(readFileSync(r.file!, 'utf8')) as { sentence: string }[]
    expect(file.map((x) => x.sentence)).toEqual(['s_u01_0003'])
    const prompt = transport.calls[0]!.messages[1]!.content as string
    expect(prompt).toContain('- id: s_u01_0003')
    expect(prompt).toContain('faAccept: ["[مرسی/ممنون/ممنونم]"]')
    // The course itself is untouched and still valid.
    expect(errorsOf(dir)).toEqual([])
    await expect(
      suggestVariants({ course: loadCourse(dir), unit: 'u01-hello', ai: client }),
    ).rejects.toThrow(/--force/)
  })

  it('dry run covers the whole unit without a client', async () => {
    const r = await suggestVariants({
      course: loadCourse(seedCopy()),
      unit: 'u01-hello',
      dryRun: true,
    })
    expect(r.dryRun!.messages[1]!.content).toContain('- id: s_u01_0025')
    await expect(
      suggestVariants({ course: loadCourse(seedCopy()), unit: 'u09-nope', dryRun: true }),
    ).rejects.toThrow(/unknown unit/)
  })
})

describe('test seed', () => {
  it('copies the live course without generated media, so tests never depend on it', () => {
    const dir = seedCopy()
    expect(existsSync(join(dir, 'assets/audio'))).toBe(false)
    expect(existsSync(join(dir, 'assets/img'))).toBe(false)
    const course = loadCourse(dir)
    expect(mediaRefs(course).filter((m) => /^(audio|img)\//.test(m.ref))).toEqual([])
    expect(course.sentences.filter((s) => s.audio?.signedOffBy !== undefined)).toEqual([])
    expect(course.sentences.length).toBeGreaterThan(0)
    expect(errorsOf(dir)).toEqual([])
  })
})

describe('art', () => {
  it('generates a character sheet with style-bible references, a sidecar and a draft image ref', async () => {
    const dir = seedCopy()
    // Hermetic: the copied course may already have a real style bible and character art.
    rmSync(join(dir, 'style-bible'), { recursive: true, force: true })
    mkdirSync(join(dir, 'style-bible'))
    const charactersFile = join(dir, 'characters.yaml')
    writeFileSync(
      charactersFile,
      readFileSync(charactersFile, 'utf8').replace(/^ +image: .*\n/gm, ''),
    )
    writeFileSync(join(dir, 'style-bible/shape-language.png'), PNG)
    writeFileSync(join(dir, 'style-bible/hodhod-turnaround.png'), PNG)
    writeFileSync(join(dir, 'style-bible/shirin-turnaround.png'), PNG)
    const { ai: client, transport } = ai(() =>
      chatResponse(null, {
        images: [toDataUrl('image/png', PNG)],
        model: 'openai/gpt-5.4-image-2',
      }),
    )
    const now = new Date('2026-09-25T00:00:00Z')
    const r = await generateArt({
      course: loadCourse(dir),
      target: { kind: 'character', id: 'hodhod' },
      ai: client,
      now,
    })
    expect(r.ref).toBe('img/characters/hodhod.png')
    expect(readFileSync(join(dir, 'assets/img/characters/hodhod.png')).equals(PNG)).toBe(true)
    expect(r.references).toEqual([
      'style-bible/hodhod-turnaround.png',
      'style-bible/shape-language.png',
    ])
    const req = transport.calls[0]!
    expect(req.model).toBe('openai/gpt-5.4-image-2')
    const parts = req.messages.at(-1)!.content as ContentPart[]
    expect(parts.map((p) => p.type)).toEqual(['text', 'image_url', 'image_url'])
    const text = (parts[0] as { text: string }).text
    expect(text).toContain('#0E9F99')
    expect(text).toContain('Character: Hodhod, mascot;')
    expect(text).not.toMatch(/duolingo|duo\b/i)

    const course = loadCourse(dir)
    expect(course.characters.find((c) => c.id === 'hodhod')).toMatchObject({
      image: 'img/characters/hodhod.png',
      status: 'draft',
    })
    expect(readSidecar(course, 'img/characters/hodhod.png')).toEqual({
      asset: 'img/characters/hodhod.png',
      model: 'openai/gpt-5.4-image-2',
      prompt: 'art-character@1',
      references: ['style-bible/hodhod-turnaround.png', 'style-bible/shape-language.png'],
      generatedAt: '2026-09-25T00:00:00.000Z',
      status: 'draft',
    })
    expect(errorsOf(dir)).toEqual([])
    await expect(
      generateArt({ course, target: { kind: 'character', id: 'hodhod' }, ai: client }),
    ).rejects.toThrow(/--force/)
  })

  it('illustrates a lexeme, keeping the file type the model returned', async () => {
    const dir = seedCopy()
    const { ai: client } = ai(() => chatResponse(null, { images: [toDataUrl('image/png', WEBP)] }))
    const r = await generateArt({
      course: loadCourse(dir),
      target: { kind: 'lexeme', id: 'lx_chay' },
      ai: client,
    })
    expect(r.ref).toBe('img/lx_chay.webp')
    expect(loadCourse(dir).lexemes.find((l) => l.id === 'lx_chay')!.image).toBe('img/lx_chay.webp')
    expect(errorsOf(dir)).toEqual([])
    const dry = await generateArt({
      course: loadCourse(dir),
      target: { kind: 'lexeme', id: 'lx_ab' },
      dryRun: true,
    })
    expect(dry.dryRun).toMatchObject({ model: 'openai/gpt-5.4-image-2', imageOutputTokens: 6000 })
    await expect(
      generateArt({
        course: loadCourse(dir),
        target: { kind: 'lexeme', id: 'lx_zzz' },
        dryRun: true,
      }),
    ).rejects.toThrow(/unknown lexeme/)
  })
})

describe('tts', () => {
  it('voices sentences from faVocalized/fa with the speaker voice and marks them for sign-off', async () => {
    const dir = seedCopy()
    setItemFields(join(dir, 'characters.yaml'), 'shirin', [{ path: ['voice'], value: 'coral' }])
    setItemFields(join(dir, 'characters.yaml'), 'kian', [{ path: ['voice'], value: 'ash' }])
    const { ai: client, transport } = ai(() =>
      chatResponse(null, { audio: { data: PCM.toString('base64') }, model: 'openai/gpt-audio' }),
    )
    // The WAV from speech() is encoded to MP3 by ffmpeg; the fake records what it was given.
    const encoded: Buffer[] = []
    const run: FfmpegRunner = async (args) => {
      encoded.push(readFileSync(args[args.indexOf('-i') + 1]!))
      writeFileSync(args.at(-1)!, MP3)
      return Buffer.alloc(0)
    }
    const now = new Date('2026-09-25T00:00:00Z')
    const r = await generateTts({
      course: loadCourse(dir),
      unit: 'u01-hello',
      ids: ['s_u01_0001', 's_u01_0004', 'lx_salam'],
      lexemes: true,
      ai: client,
      now,
      run,
    })
    expect(r.written).toEqual([
      'audio/s_u01_0001.mp3',
      'audio/s_u01_0004.mp3',
      'audio/lx_salam.mp3',
    ])
    // Speakers use their own voice; lexemes (no speaker) use the default voice.
    expect(transport.calls.map((c) => [c.audio!.voice, c.messages.at(-1)!.content])).toEqual([
      ['coral', 'سلام!'],
      ['ash', 'مرسی، خوبم.'],
      ['alloy', 'سلام'],
    ])
    expect(transport.calls[0]!.model).toBe('openai/gpt-audio')
    expect(encoded).toHaveLength(3)
    expect(encoded[0]!.subarray(44).equals(PCM)).toBe(true)
    expect(readFileSync(join(dir, 'assets/audio/s_u01_0001.mp3')).equals(MP3)).toBe(true)

    const course = loadCourse(dir)
    expect(course.sentences.find((s) => s.id === 's_u01_0001')!.audio).toEqual({
      speaker: 'shirin',
      normal: 'audio/s_u01_0001.mp3',
      signedOffBy: null,
    })
    expect(course.lexemes.find((l) => l.id === 'lx_salam')!.audio).toBe('audio/lx_salam.mp3')
    expect(readSidecar(course, 'audio/s_u01_0001.mp3')).toMatchObject({
      model: 'openai/gpt-audio',
      prompt: 'tts-line@1',
      voice: 'coral',
      input: 'سلام!',
    })
    // Comments survive the edit: the file still starts with the seed file's header line.
    const header = readFileSync(
      fileURLToPath(new URL('./fixtures/seed-fa-en/sentences/u01-hello.yaml', import.meta.url)),
      'utf8',
    ).split('\n')[0]!
    expect(header).toMatch(/^# Unit 1 sentences/)
    expect(readFileSync(join(dir, 'sentences/u01-hello.yaml'), 'utf8').split('\n')[0]).toBe(header)
    expect(errorsOf(dir)).toEqual([])

    const again = await generateTts({ course, unit: 'u01-hello', ids: ['s_u01_0001'], ai: client })
    expect(again.skipped).toEqual([
      { id: 's_u01_0001', reason: 'already has TTS audio (use --force)' },
    ])
  })

  it('never replaces a human recording, even with --force', async () => {
    const dir = seedCopy()
    mkdirSync(join(dir, 'assets/audio'), { recursive: true })
    writeFileSync(join(dir, 'assets/audio/s_u01_0002.mp3'), MP3)
    setItemFields(join(dir, 'sentences/u01-hello.yaml'), 's_u01_0002', [
      { path: ['audio', 'normal'], value: 'audio/s_u01_0002.mp3' },
    ])
    const { ai: client, transport } = ai(() =>
      chatResponse(null, { audio: { data: MP3.toString('base64') } }),
    )
    const r = await generateTts({
      course: loadCourse(dir),
      unit: 'u01-hello',
      ids: ['s_u01_0002'],
      ai: client,
      force: true,
    })
    expect(r.skipped).toEqual([{ id: 's_u01_0002', reason: 'has a human recording' }])
    expect(transport.calls).toHaveLength(0)
    expect(existsSync(join(dir, 'assets/audio/s_u01_0002.mp3.yaml'))).toBe(false)
  })

  it('dry run lists one call per clip', async () => {
    const course = loadCourse(seedCopy())
    const r = await generateTts({ course, unit: 'u01-hello', dryRun: true })
    expect(r.dryRun).toHaveLength(course.sentences.filter((s) => s.unit === 'u01-hello').length)
    expect(r.dryRun![0]).toMatchObject({ model: 'openai/gpt-audio', audioOutputTokens: 600 })
  })
})

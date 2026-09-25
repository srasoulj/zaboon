import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { pcm16ToWav } from '@zaboon/ai'
import {
  encodeTtsMp3,
  envelopeFromPcm,
  normalizeArgs,
  pcmArgs,
  processClip,
  processUnitAudio,
  slowArgs,
  TTS_TRIM,
  ttsArgs,
  type FfmpegRunner,
} from './audio'
import { seedCourseWithoutMedia } from './fixtures/seed'
import { loadCourse } from './load'
import { validateCourse } from './validate'
import { setItemFields } from './yaml-out'

const dirs: string[] = []
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'zaboon-audio-test-'))
  dirs.push(d)
  return d
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

/** 16-bit PCM: `silent` samples of silence, then `loud` samples of a full-scale square wave. */
function pcm(silent: number, loud: number): Buffer {
  const b = Buffer.alloc((silent + loud) * 2)
  for (let i = 0; i < loud; i++) b.writeInt16LE(i % 2 ? 16000 : -16000, (silent + i) * 2)
  return b
}

describe('audio processing', () => {
  it('computes an RMS envelope per 50 ms frame, scaled to 0–1', () => {
    const env = envelopeFromPcm(pcm(4000, 4000), 8000, 20)
    expect(env).toHaveLength(20)
    expect(env.slice(0, 10)).toEqual(Array(10).fill(0))
    expect(env.slice(10)).toEqual(Array(10).fill(1))
    expect(envelopeFromPcm(Buffer.alloc(0))).toEqual([])
    expect(envelopeFromPcm(Buffer.alloc(800))).toEqual([0])
  })

  it('uses −16 LUFS loudnorm, mono 64 kbps MP3 and a pitch-keeping 0.7× atempo', () => {
    const n = normalizeArgs('in.wav', 'out.mp3')
    expect(n).toEqual(
      expect.arrayContaining([
        '-af',
        'loudnorm=I=-16:TP=-1.5:LRA=11',
        '-ac',
        '1',
        '-b:a',
        '64k',
        '-c:a',
        'libmp3lame',
      ]),
    )
    expect(n.at(-1)).toBe('out.mp3')
    expect(slowArgs('in.wav', 'slow.mp3')).toContain('atempo=0.7,loudnorm=I=-16:TP=-1.5:LRA=11')
    expect(pcmArgs('x.mp3').slice(-7)).toEqual(['-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'])
  })

  it('processes a unit: writes slow clips and envelopes and points the YAML at them', async () => {
    const dir = seedCourseWithoutMedia(temp())
    mkdirSync(join(dir, 'assets/audio'), { recursive: true })
    writeFileSync(join(dir, 'assets/audio/s_u01_0001.mp3'), 'raw tts')
    setItemFields(join(dir, 'sentences/u01-hello.yaml'), 's_u01_0001', [
      { path: ['audio', 'normal'], value: 'audio/s_u01_0001.mp3' },
    ])
    const calls: string[][] = []
    const fake: FfmpegRunner = async (args) => {
      calls.push(args)
      const out = args.at(-1)!
      if (out === 'pipe:1') return pcm(800, 800)
      writeFileSync(
        out,
        `processed ${args.includes('atempo=0.7,loudnorm=I=-16:TP=-1.5:LRA=11') ? 'slow' : 'normal'}`,
      )
      return Buffer.alloc(0)
    }
    const r = await processUnitAudio({ course: loadCourse(dir), unit: 'u01-hello', run: fake })
    expect(r.processed).toEqual(['s_u01_0001'])
    expect(r.skipped.find((s) => s.id === 's_u01_0002')).toEqual({
      id: 's_u01_0002',
      reason: 'no audio.normal file',
    })
    expect(calls).toHaveLength(3)
    const audio = join(dir, 'assets/audio')
    expect(readFileSync(join(audio, 's_u01_0001.mp3'), 'utf8')).toBe('processed normal')
    expect(readFileSync(join(audio, 's_u01_0001.slow.mp3'), 'utf8')).toBe('processed slow')
    expect(JSON.parse(readFileSync(join(audio, 's_u01_0001.envelope.json'), 'utf8'))).toEqual([
      0, 0, 1, 1,
    ])
    const course = loadCourse(dir)
    expect(course.sentences.find((s) => s.id === 's_u01_0001')!.audio).toEqual({
      speaker: 'shirin',
      normal: 'audio/s_u01_0001.mp3',
      slow: 'audio/s_u01_0001.slow.mp3',
      envelope: 'audio/s_u01_0001.envelope.json',
    })
    expect(
      validateCourse(course, { allowDrafts: true }).filter((i) => i.severity === 'error'),
    ).toEqual([])
    const again = await processUnitAudio({
      course,
      unit: 'u01-hello',
      ids: ['s_u01_0001'],
      run: fake,
    })
    expect(again.skipped).toEqual([{ id: 's_u01_0001', reason: 'already processed (use --force)' }])
  })

  it('encodes TTS audio (a WAV) as the house MP3 through a temp file', async () => {
    const wav = pcm16ToWav(pcm(10, 10))
    let seen: string[] = []
    let input: Buffer | null = null
    const fake: FfmpegRunner = async (args) => {
      seen = args
      input = readFileSync(args[args.indexOf('-i') + 1]!)
      writeFileSync(args.at(-1)!, 'mp3 bytes')
      return Buffer.alloc(0)
    }
    const mp3 = await encodeTtsMp3(wav, fake)
    expect(mp3.toString()).toBe('mp3 bytes')
    expect(input!.equals(wav)).toBe(true)
    expect(seen).toEqual(ttsArgs(seen[seen.indexOf('-i') + 1]!, seen.at(-1)!))
    // Silence is trimmed on the raw audio, then the clip is normalized like `audio` does.
    expect(seen[seen.indexOf('-af') + 1]).toBe(`${TTS_TRIM},loudnorm=I=-16:TP=-1.5:LRA=11`)
    expect(seen.slice(-9, -1)).toEqual([
      '-ac',
      '1',
      '-ar',
      '44100',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '64k',
    ])
    expect(existsSync(seen.at(-1)!)).toBe(false) // the temp dir is removed
  })

  it('encodes a real TTS WAV with ffmpeg, trimming padded silence (or says it is missing)', async () => {
    // 0.3 s of silence, 0.5 s of a 440 Hz tone, 1.5 s of silence, at 24 kHz like gpt-audio.
    const rate = 24_000
    const [lead, tone, tail] = [0.3 * rate, 0.5 * rate, 1.5 * rate]
    const wav = Buffer.alloc((lead + tone + tail) * 2)
    for (let i = 0; i < tone; i++)
      wav.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), (lead + i) * 2)
    if (spawnSync('ffmpeg', ['-version']).status !== 0) {
      await expect(encodeTtsMp3(pcm16ToWav(wav))).rejects.toThrow(/ffmpeg is not installed/)
      return
    }
    const file = join(temp(), 'tts.mp3')
    writeFileSync(file, await encodeTtsMp3(pcm16ToWav(wav)))
    const probe = JSON.parse(
      spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {
        encoding: 'utf8',
      }).stdout,
    ) as { streams: { codec_name: string; channels: number }[]; format: { duration: string } }
    expect(probe.streams[0]).toMatchObject({ codec_name: 'mp3', channels: 1 })
    // 2.3 s in; about 0.05 + 0.5 + 0.25 s out (plus MP3 encoder padding).
    expect(Number(probe.format.duration)).toBeGreaterThan(0.7)
    expect(Number(probe.format.duration)).toBeLessThan(1)
  }, 30_000)

  it('runs the real ffmpeg when it is installed, and says so clearly when it is not', async () => {
    const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
    const dir = temp()
    if (!hasFfmpeg) {
      await expect(processClip(join(dir, 'x.wav'), dir, 'x')).rejects.toThrow(
        /ffmpeg is not installed/,
      )
      return
    }
    const input = join(dir, 'tone.wav')
    spawnSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-ac',
      '2',
      input,
    ])
    const out = await processClip(input, dir, 's_x_0001')
    const probe = (f: string) =>
      JSON.parse(
        spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f], {
          encoding: 'utf8',
        }).stdout,
      ) as {
        streams: { codec_name: string; channels: number; bit_rate: string }[]
        format: { duration: string }
      }
    const normal = probe(out.normal)
    expect(normal.streams[0]).toMatchObject({ codec_name: 'mp3', channels: 1, bit_rate: '64000' })
    const slow = probe(out.slow)
    expect(Number(slow.format.duration) / Number(normal.format.duration)).toBeCloseTo(1 / 0.7, 1)
    const env = JSON.parse(readFileSync(out.envelope, 'utf8')) as number[]
    expect(env.length).toBeGreaterThanOrEqual(19)
    expect(Math.max(...env)).toBe(1)
    expect(existsSync(join(dir, 's_x_0001.mp3'))).toBe(true)
  }, 30_000)
})

/**
 * `audio` (LEARNING-ENGINE §4.1 step 5): post-processes sentence audio with ffmpeg.
 *
 *   <id>.mp3           loudness-normalized to −16 LUFS (EBU R128 loudnorm), mono, 64 kbps MP3
 *   <id>.slow.mp3      the 0.7× "turtle" clip (atempo keeps the pitch), same loudness and format
 *   <id>.envelope.json the amplitude envelope for character lip-sync: RMS per 50 ms frame, scaled
 *                      to 0–1, as a JSON array (the format of content/fixtures)
 *
 * Content-hashed file names are applied later by `build`. ffmpeg runs through an injectable
 * runner so tests can check the exact filter chains without the binary.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LoadedCourse } from './load'
import { setItemFields } from './yaml-out'

export const TARGET_LUFS = -16
export const LOUDNORM = `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11`
export const SLOW_TEMPO = 0.7
export const ENVELOPE_FPS = 20
const ENVELOPE_RATE = 8_000

/** Runs ffmpeg with `args` and resolves with its stdout. */
export type FfmpegRunner = (args: string[]) => Promise<Buffer>

export const runFfmpeg: FfmpegRunner = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => err.push(d))
    child.on('error', (e: NodeJS.ErrnoException) =>
      reject(
        e.code === 'ENOENT'
          ? new Error('ffmpeg is not installed (needed by `content audio`)', { cause: e })
          : e,
      ),
    )
    child.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(out))
        : reject(
            new Error(`ffmpeg exited with ${code}: ${Buffer.concat(err).toString().slice(-500)}`),
          ),
    )
  })

const encode = ['-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k']
const base = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y']

export function normalizeArgs(input: string, output: string): string[] {
  return [...base, '-i', input, '-af', LOUDNORM, ...encode, output]
}

export function slowArgs(input: string, output: string): string[] {
  return [...base, '-i', input, '-af', `atempo=${SLOW_TEMPO},${LOUDNORM}`, ...encode, output]
}

/**
 * gpt-audio pads its clips with near-digital silence (up to ~2 s after the speech). Both ends are
 * trimmed on the raw audio, before loudnorm raises the noise floor, keeping 50 ms before the
 * speech and 250 ms after it, so playback and lip-sync end when the voice does.
 */
export const TTS_TRIM =
  'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,' +
  'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.25,areverse'

/** A TTS clip → the house MP3: trimmed, −16 LUFS, mono, 64 kbps. */
export function ttsArgs(input: string, output: string): string[] {
  return [...base, '-i', input, '-af', `${TTS_TRIM},${LOUDNORM}`, ...encode, output]
}

/**
 * TTS audio (the WAV from `speech()`) → the house MP3, through a temp dir. Lexeme clips are used
 * as written (`audio` only processes sentences), so every TTS clip is normalized here.
 */
export async function encodeTtsMp3(bytes: Buffer, run: FfmpegRunner = runFfmpeg): Promise<Buffer> {
  const work = mkdtempSync(join(tmpdir(), 'zaboon-tts-'))
  try {
    const input = join(work, 'speech.wav')
    const output = join(work, 'speech.mp3')
    writeFileSync(input, bytes)
    await run(ttsArgs(input, output))
    return readFileSync(output)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** Decodes to raw 16-bit mono PCM on stdout, for the envelope. */
export function pcmArgs(input: string): string[] {
  return [...base, '-i', input, '-ac', '1', '-ar', String(ENVELOPE_RATE), '-f', 's16le', 'pipe:1']
}

/** RMS per frame of 16-bit little-endian mono PCM, scaled so the loudest frame is 1. */
export function envelopeFromPcm(
  pcm: Buffer,
  sampleRate = ENVELOPE_RATE,
  fps = ENVELOPE_FPS,
): number[] {
  const perFrame = Math.max(1, Math.round(sampleRate / fps))
  const samples = Math.floor(pcm.length / 2)
  const frames: number[] = []
  for (let start = 0; start < samples; start += perFrame) {
    const end = Math.min(samples, start + perFrame)
    let sum = 0
    for (let i = start; i < end; i++) {
      const v = pcm.readInt16LE(i * 2) / 32768
      sum += v * v
    }
    frames.push(Math.sqrt(sum / (end - start)))
  }
  const peak = Math.max(0, ...frames)
  return frames.map((f) => (peak > 0 ? Math.round((f / peak) * 100) / 100 : 0))
}

export interface ProcessedClip {
  normal: string
  slow: string
  envelope: string
}

/** Processes one clip: `input` → the three outputs under `outDir`, named after `id`. */
export async function processClip(
  input: string,
  outDir: string,
  id: string,
  run: FfmpegRunner = runFfmpeg,
): Promise<ProcessedClip> {
  const work = mkdtempSync(join(tmpdir(), 'zaboon-audio-'))
  try {
    const normal = join(work, `${id}.mp3`)
    const slow = join(work, `${id}.slow.mp3`)
    await run(normalizeArgs(input, normal))
    await run(slowArgs(input, slow))
    const envelope = envelopeFromPcm(await run(pcmArgs(normal)))
    const out = {
      normal: join(outDir, `${id}.mp3`),
      slow: join(outDir, `${id}.slow.mp3`),
      envelope: join(outDir, `${id}.envelope.json`),
    }
    // Written last and moved into place, so a failed run never leaves a half-processed clip.
    writeFileSync(out.envelope, `${JSON.stringify(envelope)}\n`)
    renameSync(slow, out.slow)
    renameSync(normal, out.normal)
    return out
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

export interface AudioOptions {
  course: LoadedCourse
  unit: string
  ids?: string[]
  /** Reprocess clips that already have slow + envelope files. */
  force?: boolean
  run?: FfmpegRunner
  log?: (line: string) => void
}

export interface AudioResult {
  processed: string[]
  skipped: { id: string; reason: string }[]
}

export async function processUnitAudio(opts: AudioOptions): Promise<AudioResult> {
  const { course } = opts
  if (!course.units.some((u) => u.id === opts.unit)) throw new Error(`unknown unit ${opts.unit}`)
  const processed: string[] = []
  const skipped: AudioResult['skipped'] = []
  const assets = join(course.dir, 'assets')
  for (const s of course.sentences) {
    if (s.unit !== opts.unit || (opts.ids && !opts.ids.includes(s.id))) continue
    const normal = s.audio?.normal
    if (!normal || !existsSync(join(assets, normal))) {
      skipped.push({ id: s.id, reason: 'no audio.normal file' })
      continue
    }
    const dir = normal.slice(0, normal.lastIndexOf('/'))
    const stem = normal.slice(normal.lastIndexOf('/') + 1).replace(/\.[a-z0-9]+$/, '')
    const refs = { slow: `${dir}/${stem}.slow.mp3`, envelope: `${dir}/${stem}.envelope.json` }
    if (
      !opts.force &&
      existsSync(join(assets, refs.slow)) &&
      existsSync(join(assets, refs.envelope))
    ) {
      skipped.push({ id: s.id, reason: 'already processed (use --force)' })
      continue
    }
    await processClip(join(assets, normal), join(assets, dir), stem, opts.run)
    const file = join(course.dir, course.sources.get(`sentence:${s.id}`)!)
    setItemFields(file, s.id, [
      ...(normal.endsWith('.mp3')
        ? []
        : [{ path: ['audio', 'normal'], value: `${dir}/${stem}.mp3` }]),
      { path: ['audio', 'slow'], value: refs.slow },
      { path: ['audio', 'envelope'], value: refs.envelope },
    ])
    processed.push(s.id)
    opts.log?.(`audio ${s.id}: normalized, slow clip and envelope written`)
  }
  return { processed, skipped }
}

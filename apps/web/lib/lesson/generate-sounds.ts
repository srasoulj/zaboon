/**
 * Regenerates apps/web/public/sounds/effects.{mp3,webm} from synth.ts (needs ffmpeg):
 *   pnpm --filter @zaboon/web exec tsx lib/lesson/generate-sounds.ts
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeWav, renderSprite } from './synth'

const outDir = fileURLToPath(new URL('../../public/sounds/', import.meta.url))
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), 'zaboon-sounds-'))
try {
  const wav = join(tmp, 'effects.wav')
  writeFileSync(wav, encodeWav(renderSprite()))
  const ff = (...args: string[]) =>
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, ...args])
  ff('-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '64k', join(outDir, 'effects.mp3'))
  ff('-ac', '1', '-codec:a', 'libopus', '-b:a', '48k', join(outDir, 'effects.webm'))
  console.info(`wrote ${outDir}effects.{mp3,webm}`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

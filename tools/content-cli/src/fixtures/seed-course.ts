/**
 * A private copy of the fa-en course AS IT WAS when the pipeline tests were written: the
 * hand-written seed (Unit 1, the letters, stubs for units 2–5). The live course keeps growing (AI
 * drafts, media), so tests copy it for its hand-made assets (style bible, character art) without the
 * pipeline's generated media (assets/audio, assets/img), delete every text file the seed didn't
 * have and overlay the frozen seed text from ./seed-fa-en (snapshot of content/fa-en at d3ea26d).
 */
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repoRoot } from '../paths'

const SEED = fileURLToPath(new URL('./seed-fa-en', import.meta.url))
const TEXT_DIRS = ['units', 'lexemes', 'sentences', 'chats', 'guidebooks', 'suggestions']

/** Where `tts`, `audio` and `art` write generated media (assets/audio, assets/img): never copied. */
const GENERATED_MEDIA = new Set(['audio', 'img'])

export function seedCourseCopy(dest: string): string {
  const from = join(repoRoot(), 'content/fa-en')
  cpSync(from, dest, {
    recursive: true,
    filter: (src) => {
      const [top, sub] = relative(from, src).split(sep)
      return !(top === 'assets' && sub !== undefined && GENERATED_MEDIA.has(sub))
    },
  })
  for (const sub of TEXT_DIRS) {
    const dir = join(dest, sub)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir))
      if (!existsSync(join(SEED, sub, f))) rmSync(join(dir, f), { recursive: true, force: true })
  }
  cpSync(SEED, dest, { recursive: true })
  return dest
}

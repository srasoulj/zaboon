/**
 * A private copy of the fa-en course AS IT WAS when the pipeline tests were written: the
 * hand-written seed (Unit 1, the letters, stubs for units 2–5). The live course keeps growing (AI
 * drafts, media), so tests copy it for its assets, delete every text file the seed didn't have and
 * overlay the frozen seed text from ./seed-fa-en (snapshot of content/fa-en at d3ea26d).
 */
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repoRoot } from '../paths'

const SEED = fileURLToPath(new URL('./seed-fa-en', import.meta.url))
const TEXT_DIRS = ['units', 'lexemes', 'sentences', 'chats', 'guidebooks', 'suggestions']

export function seedCourseCopy(dest: string): string {
  cpSync(join(repoRoot(), 'content/fa-en'), dest, { recursive: true })
  for (const sub of TEXT_DIRS) {
    const dir = join(dest, sub)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir))
      if (!existsSync(join(SEED, sub, f))) rmSync(join(dir, f), { recursive: true, force: true })
  }
  cpSync(SEED, dest, { recursive: true })
  return dest
}

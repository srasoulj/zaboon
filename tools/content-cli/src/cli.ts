/**
 * zaboon-content: the content pipeline CLI entry point (docs/LEARNING-ENGINE.md §4).
 * Commands live in ./program.ts: validate · build · publish · draft · suggest · art · tts ·
 * audio · models check.
 */
import { createProgram } from './program'

createProgram()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })

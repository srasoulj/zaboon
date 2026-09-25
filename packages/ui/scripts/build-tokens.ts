/**
 * Generates packages/ui/src/styles.css from tokens.json + src/components.css.
 *   pnpm --filter @zaboon/ui tokens          # write the file
 *   pnpm --filter @zaboon/ui tokens --check  # exit 1 if the committed file is stale
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildStylesCss } from '../src/build-css'
import { tokens } from '../src/tokens'

const componentsPath = fileURLToPath(new URL('../src/components.css', import.meta.url))
const outPath = fileURLToPath(new URL('../src/styles.css', import.meta.url))

const css = buildStylesCss(tokens, readFileSync(componentsPath, 'utf8'))

if (process.argv.includes('--check')) {
  const current = readFileSync(outPath, 'utf8')
  if (current !== css) {
    console.error('styles.css is stale: run `pnpm --filter @zaboon/ui tokens`')
    process.exit(1)
  }
  console.info('styles.css is up to date')
} else {
  writeFileSync(outPath, css)
  console.info(`wrote ${outPath}`)
}

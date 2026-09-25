/**
 * zaboon-content: the content pipeline CLI (docs/LEARNING-ENGINE.md §4).
 * Wave 0 stub: `validate` succeeds so `pnpm verify` runs end to end. ws-content-cli implements
 * draft · suggest · art · tts · audio · validate · build · publish · models.
 */
import { Command } from 'commander'

const program = new Command()
program.name('zaboon-content').description('Zaboon content pipeline')

program
  .command('validate')
  .description('Validate course content (stub until ws-content-cli lands)')
  .option('--fixtures', 'also validate content/fixtures (strict)')
  .option('--allow-drafts', 'allow status: draft items (dev builds only)')
  .action(() => {
    console.info('content validate: stub (no content yet), ok')
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})

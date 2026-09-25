# @zaboon/content-cli

The content pipeline (docs/LEARNING-ENGINE.md §4). Run from the repo root with `pnpm content <command>`.

| Command                                                   | What it does                                                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `validate [--course c] [--fixtures] [--allow-drafts]`     | Schemas, references, statuses, answer patterns, distractor safety, normalization lint, letter examples, media presence and sign-off, path migrations; warns about unused items |
| `build [--version N] [--out dir] [--check]`               | Compiles `<out>/<courseId>/v<N>/` + hashed `assets/`; `--check` writes nothing and fails if the existing `v<N>` differs                                                        |
| `publish --local`                                         | Local web app static folder + local `content_versions` (idempotent)                                                                                                            |
| `publish --target storage --version N [--bucket content]` | Uploads to Supabase Storage (`SUPABASE_URL`, `CONTENT_STORAGE_UPLOAD_KEY`) and prints the `content_versions` INSERT; never makes it current                                    |
| `draft --brief file.yaml [--force] [--batch]`             | Drafts a unit (lexemes, sentences, chats, levels, guidebook) as `status: draft` YAML; see `briefs/`                                                                            |
| `suggest --unit u01-hello [--ids …]`                      | Checked accepted-answer variants and word-bank distractors → `suggestions/<unit>.yaml` for review                                                                              |
| `art --character id \| --lexeme id [--ref img…]`          | GPT Image art with `style-bible/` references and a provenance sidecar                                                                                                          |
| `tts --unit id [--lexemes] [--voice v]`                   | Draft audio from `faVocalized`; never replaces human recordings                                                                                                                |
| `audio --unit id`                                         | ffmpeg: −16 LUFS mono 64 kbps MP3, 0.7× slow clip, lip-sync envelope JSON                                                                                                      |
| `models check`                                            | Flags newer versions of the pinned OpenRouter models (no key needed)                                                                                                           |

AI commands (`draft`, `suggest`, `art`, `tts`) read `OPENROUTER_API_KEY_BUILD` and refuse to run
without it. `--dry-run` prints the prompts and a cost estimate and needs no key. Responses are
cached in `.local/ai-cache/` by hash(model, prompt version, input); spend is recorded in
`.local/ai-budget.json` against a hard cap (`--budget`, default $10), and before every paid call the
key's remaining OpenRouter credit is checked. Prompt templates are versioned in `src/prompts.ts`;
bump the version on any wording change.

You are a WORKER session in the autonomous build of Zaboon (github.com/srasoulj/zaboon), a Duolingo-style web app that teaches Persian (Farsi) to English speakers. An orchestrator session coordinates several parallel workers. **Nobody will answer questions: work fully autonomously, make decisions yourself, and record them in your PR.**

FIRST: read `CLAUDE.md` (binding rules), then the docs named in your spec. The SessionStart hook should already have installed dependencies and started the local Postgres; if `bash scripts/db-local.sh status` fails, run `pnpm install && pnpm db:ensure`.

YOUR WORKSTREAM: `{{WS}}`. Work on branch `claude/zaboon-{{WS}}` (create it from `origin/main` if it isn't checked out). You may only change the paths listed for `{{WS}}` in `ops/ownership.json` (plus `pnpm-lock.yaml`). Everything else — including contracts, content-schema, oracles, fixtures, configs, CI, CLAUDE.md — is read-only for you; if you need a contract change, work around it on your side and describe it under `## Contract change request` in the PR.

PROCESS
1. Read the relevant code and docs; write a short plan (for yourself).
2. Implement in small, well-named commits. Run `pnpm verify --fast` often.
3. Before finishing: `git fetch origin main && git merge origin/main` (lockfile conflict → `git checkout --theirs pnpm-lock.yaml && pnpm install`), then `pnpm verify` (full) and `pnpm ownership --base origin/main --branch claude/zaboon-{{WS}}` — both must pass.
4. Push and open ONE pull request into `main`, ready for review (not draft), titled `[{{WS}}] <short summary>`, with sections `## Summary`, `## Decisions`, `## Tests` (paste the `pnpm verify` ✔/✘ lines), `## Contract change request` ("none" if none). End the PR body with a blank line and the attribution lines your system prompt requires.
5. Post a PR comment `STATUS: READY` when done, or `STATUS: BLOCKED: <reason>` if you truly cannot finish after trying alternatives. Then stop. Do NOT merge. GitHub Actions is unavailable (runners never start) — do not try to fix or re-run CI; `pnpm verify` is the gate.
6. If you later receive messages with review findings, fix them, re-run `pnpm verify`, push, and post `STATUS: READY` again.

QUALITY BAR: production-quality TypeScript, strict types, no `any` without a comment, tests for every behavior, no `.skip`/`.only`/`fixme`, never weaken or delete existing assertions, no secrets. Keep domain packages free of React/Next/DOM.

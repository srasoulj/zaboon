SPEC: Wave 4 (stretch). The `ws-typing` session builds `speak` and then Stories: two PRs, one after the other.

- PR 1: `[ws-typing] Speak`, branch `claude/zaboon-ws-typing-2`, flag `speak`.
- PR 2: `[ws-typing] Stories`, branch `claude/zaboon-ws-typing-3`, flag `stories`.

Start PR 2 only after PR 1 has merged (`git fetch origin main`; branch from the new main). Post `STATUS: READY` on each PR. The orchestrator reviews and merges them one at a time.

OWNERSHIP (see `ops/ownership.json`, workstream `ws-typing`):
- **What you already own:** the session engine, renderers, the UI kit and typing.
- **ws-engagement's former paths**, since ws-engagement is done: `lib/server/sessions.ts`, `home.ts`, `engagement/**`, the lesson player (`components/lesson/**`, `lib/lesson/{machine,request,summary}.ts`), `packages/game-rules/src/**`, the engagement repos, and the `/api/sessions`, `/api/practice` and shop/lives/leaderboard/quests routes.
- **New for Wave 4:**
  - `apps/web/app/api/speech/**`, `apps/web/lib/server/speech/**`, `apps/web/lib/speech/**`;
  - `apps/web/components/speak/**`, `apps/web/components/stories/**`, `apps/web/lib/server/stories/**`;
  - `packages/ai/**` except `ai.models.yaml`, and `tools/content-cli/**`;
  - `packages/db/src/repos/speech*`;
  - new migrations `supabase/migrations/20260927*` with pgTAP `supabase/tests/006_*`;
  - the path UI: `apps/web/components/path/**`, `apps/web/app/(app)/learn/**`, `e2e/path/**` (ws-path-letters is done);
  - `apps/web/tests/{speak,stories}/**`, `e2e/{speak,stories}/**`.
- **Fixtures, append-only:** `content/fixtures/units/u01-fixture.yaml`, `content/fixtures/stories/**` and `content/fixtures/README.md`.
  - Add new levels at the END of the unit only. Never change or remove existing levels or items: the MVP and Wave 3 golden sessions must stay byte-identical.
  - The rest of `content/` stays orchestrator-owned; reuse existing items and media.
- **Still protected:** contracts, content-schema, the challenge registry, `signing.ts`, `env.ts`, `e2e/fixtures`. If you need a change there, add a `## Contract change request` and work around it meanwhile.

READ:
- `CLAUDE.md`.
- `docs/LEARNING-ENGINE.md`: §2 (content model, levels, Story), the challenge table rows for `speak` and `story`, and §7 (grader).
- `docs/ARCHITECTURE.md`:
  - §7 (`POST /api/speech/transcribe`);
  - §9 (RLS and grants for any new table);
  - §11 (OpenRouter; the app key `OPENROUTER_API_KEY_APP`; model `app_transcribe` in `packages/ai/ai.models.yaml`);
  - §12 (privacy: speech audio is processed transiently and never stored).
- ADR 0008 and ADR 0009.
- The Wave 4 contracts, already on main:
  - the `transcribe` route; `TranscribeRequest`/`TranscribeResponse`; `SPEECH_AUDIO_FORMATS`; `TEST_TRANSCRIPT_PREFIX`;
  - the audio `ChallengeResponse` with `token?` and `declined?`;
  - `SpeakChallenge.translation?`; the full `StoryChallenge`;
  - `SessionKind` 'story'; `CreateSessionRequest.speakPaused?`;
  - `AppConfig.speech`; errors `quota_exceeded` (429) and `unavailable` (503).
- Content-schema `Story`/`StoryLine`/`StoryQuestion`/`Level.story`/`UnitBundle.stories`.
- `apps/web/lib/server/signing.ts` (purpose-scoped HMAC tokens).
- `e2e/fixtures/browser-fakes.ts` (`fakeMicrophone`, `denyMicrophone`).

ALWAYS: with a Wave 4 flag off, the app behaves exactly as today. The MVP golden sessions and the Wave 3 sessions are byte-identical, nothing new appears in home or results, and the new routes answer 404.

PART 1 — SPEAK (flag `speak`)
1. **Engine:**
   - Already on main from the orchestrator: `SessionFeatures.speak`, `GATED_CATEGORIES.speaking = 'speak'`, and a gated `speaking` weight in the standard/practice/legendary mix profiles. With the feature off the weight is deleted, so sessions are unchanged.
   - Implement the `speaking` pool: gated like `typing`, it draws randomness only while the feature is on.
   - A `speak` builder for sentences: the prompt is the sentence's Persian, the `translation` is the English, and the answer graph is compiled for spoken transcripts. That means lenient: orthography variants and typo/spelling leniency, digits and punctuation ignored, no pronoun drop, no register swap.
   - `mvpTwin(speak)` = `listen_tap` on the same sentence, so a pinned speak level plays with the flag off.
2. **Route `POST /api/speech/transcribe`** (`withRoute(routes.transcribe, …)`, flag `speak`, else 404):
   - Validate the session and index: the session is the caller's, open, and not expired, and the challenge at that index is `speak`.
   - Enforce `AppConfig.speech` limits (size, duration, format) and a per-user daily quota (`quota_exceeded` 429). The quota needs a small table: a migration with RLS `TO app_server`, a pgTAP test and a repo.
   - Transcribe through `@zaboon/ai` with the APP key (`OPENROUTER_API_KEY_APP`, model `app_transcribe`):
     - never store or log the audio;
     - don't use the AI cache;
     - a provider failure → 503 `unavailable`.
   - In local mode ONLY, audio whose bytes start with `TEST_TRANSCRIPT_PREFIX` transcribes to the rest of the bytes, with no network. Tests use this; `MockTransport` covers the real path in unit tests.
   - Return `{transcript, token, remaining}`. The token comes from `signing.ts`, purpose `speech`, and is bound to user, session, index, the SHA-256 of the NFC-normalized transcript, and exp = the session's expiry.
3. **`/complete` re-grade:**
   - For a `speak` answer, verify the token (user, session, index, transcript hash). A missing or mismatched token grades `wrong`, whatever the client says.
   - Strip the token before storing answers.
   - `{kind:'audio', declined:true}` ("Can't speak now") grades `correct` for hearts and re-queue, but is non-rated: no SRS and no mistake resolution. Reuse the declined-attempt rule #53 added for traces.
4. **Renderer `components/speak`:**
   - A microphone button with MediaRecorder: webm/opus, falling back to mp4/m4a on Safari.
   - Recording states, a level meter, the transcript shown after, and the challenge's Persian prompt with `lang="fa" dir="rtl"`.
   - "Can't speak now" submits declined AND pauses speaking for `speech.pauseMinutes`: store it per user on the device, and new sessions are created with `speakPaused: true` so they contain no speak challenges.
   - A denied or missing microphone takes the same path, with a clear message.
   - The renderer gets the API through a `SpeechService` built by the lesson player, because renderers never call the API directly.
   - Register it in `components/challenges/index.ts`. The registry already has optional `speak` and `story` slots: `P2ChallengeType` includes them.
   - If a renderer needs a new `ChallengeRendererProps` field (the speech service), request it in a CCR and pass it through the player meanwhile, for example via React context.
5. **Tests:**
   - Unit: builder determinism, the lenient graph, gating, `mvpTwin`.
   - DB: the quota, token verification (forged, missing, other user, other index), declined non-rated, and flags off.
   - e2e (fixture level `u01-v1`, which you append: "Speaking", `pinnedOnly`, speak pins on sentences the unit already uses):
     - with the flag on and `fakeMicrophone`, correct → XP;
     - a wrong utterance costs a heart;
     - "Can't speak now" keeps hearts, and the next session has no speak challenge;
     - `denyMicrophone` falls back;
     - an API spec shows a forged transcript without a token counts as wrong;
     - flag off: `u01-v1` plays `listen_tap` twins and transcribe answers 404.

PART 2 — STORIES (flag `stories`)
1. **Content CLI** (`tools/content-cli`):
   - Load `stories/*.yaml` into the course.
   - Validate:
     - Story schema;
     - speakers in the story's `characters` and in `characters.yaml`;
     - tokens spell `fa`;
     - lexemes introduced at or before the story's unit;
     - question `after` in range and `answer` in range;
     - a level has `kind: story` exactly when it names an existing story of its own unit;
     - media refs exist.
   - Lint story lines.
   - Build stories into the unit bundle with hashed media. Fixtures are validated strict; fa-en with `--allow-drafts`.
2. **Engine:**
   - A story session (`kind: 'story'`, one level) is a sequence of `story` challenges, one per beat: the lines up to and including the question, then the question. A closing beat may have no question (response `{kind:'none'}`).
   - `gradeStory` checks the choice index.
   - Deterministic, schema-valid, rebuildable from refs.
   - Story sessions spend no hearts, and a wrong answer is retried in place, not re-queued.
3. **Server:**
   - `createSession` accepts `kind: 'story'` only while `flags.stories` is on (else 400 validation, as today). This needs a migration widening the `sessions.kind` CHECK, with pgTAP.
   - XP `xp.base.story`.
   - Completing a story completes its path level.
4. **Path:** a story node plays in the lesson player while the flag is on and shows "Coming soon" while it's off. Stories never block the path.
5. **Renderer `components/stories`** (Duolingo-like):
   - an illustrated header;
   - lines appear one by one, each with the speaker's portrait (`Character`), audio (tap to replay) and the English on tap;
   - comprehension questions with choice cards.
   - Persian lines are whole-word RTL islands (`lang="fa" dir="rtl"`; never split a word).
   - Keyboard: Space or Enter continues, digits choose.
   - No report button on story lines.
6. **Fixture:**
   - `content/fixtures/stories/u01-fixture.yaml`: story `st_u01_tea`, 3 beats, using only existing lexemes, sentences, characters and media. Example: Leila سلام، خوبی؟ / Hodhod خوبم، مرسی / Leila چای می‌خوای؟ → "What does Leila offer?"
   - Level `u01-st1` (`kind: story`, `story: st_u01_tea`) appended to u01.
7. **Tests:**
   - CLI: rejects a broken story.
   - Unit: story plan and grade.
   - DB: flags on/off, XP, the level completes.
   - e2e: play `u01-st1` with the flag on (3 beats; a wrong answer costs no heart and is retried; XP; the node shows completed), axe, and every `[lang=fa]` has `dir="rtl"`. With the flag off the node shows "Coming soon".

RULES AND PITFALLS
- The MVP and Wave 3 golden sessions must stay byte-identical. Record a new golden only for your own features' sessions if you add one.
- Keep the Wave 3 rules intact: declined traces are non-rated, the Enter rule and outbox identity, `speakPaused` must not change `requestKey` when absent, and saved snapshots still resume.
- No secrets. Tests never call the network (`MockTransport` and the local-mode transcript prefix).
- The on-device pause is per user id, so switching accounts doesn't leak it.
- Re-record only the screenshot baselines your new nodes change (the path gains `u01-v1` and `u01-st1`), and check them visually.

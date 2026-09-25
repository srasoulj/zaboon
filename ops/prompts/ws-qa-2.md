SPEC: `ws-qa` (this session: `ws-qa-2`, branch `claude/zaboon-ws-qa-2`). Acceptance and regression tests for Wave 3 with its flags on (leagues, quests, coins and the shop, the practice hub, the Persian keyboard and typed Persian, letter tracing), plus precise bug reports.

Read: CLAUDE.md (rule 9: `setTestFlags`/`flagsHeader`, `x-test-now`, `cronHeaders()`); docs/ARCHITECTURE.md §6 (game rules), §7 (API, rate limits, anti-cheat), §9 (RLS), §10.6 (league rollover), §15 (acceptance tests); docs/LEARNING-ENGINE.md §6–7 (typed Persian, tracing, grading); the Wave 3 specs `ops/prompts/ws-engagement.md` and `ops/prompts/ws-typing.md`; the `## Decisions` sections of PRs #48 and #49 (they record intended behaviour, for example that a declined trace grades correct). Helpers you can import (never edit): `e2e/engagement/helpers.ts` (`ENGAGEMENT_ON`, `randomPastWeek`, `playLesson`, `loseHearts`, `grantCoins`), `e2e/fixtures` (`setTestFlags`, `flagsHeader`, `setTestNow`, `cronHeaders`), `apps/web/tests/engagement/helpers.ts`, `apps/web/tests/api/play.ts`, `e2e/qa/support.ts`. See how the real renderers are operated in `e2e/typing/typing.spec.ts` and `e2e/renderers/**` (typing with the on-screen keyboard, synthetic pointer strokes for tracing).

Write ONLY new or existing files under `e2e/qa/**` and `apps/web/tests/qa/**`, except `e2e/qa/golden*.ts` (orchestrator-owned). You never change app code.

DELIVER
1. **All flags on, in the real player** (the workers mostly tested one feature at a time). A member with `leagues`, `quests`, `shop`, `practiceHub`, `persianKeyboard` and `letterTrace` all on plays the fixture's `u01-t1`: types Persian with the on-screen keyboard and with physical keys (remapped), fills the cloze blank, traces a letter (a synthetic stroke that follows the guide passes; a scribble fails and costs a heart; "Can't trace now" keeps every heart), and completes. Then: the complete sequence shows the daily goal, then the league and quest screens; `/api/home` carries `coins`, `league` and `quests`; the leaderboard lists the learner; quest coins reach the wallet; buying a streak freeze and a heart refill works from the UI; each practice-hub mode (mixed, mistakes, listening, typing) starts a practice session whose challenge kinds match the mode (check the created session through the API).
2. **Flag matrix (API level, keep it light).** Each engagement flag alone, and all off: the P2 routes answer 404 while their flag is off, and no new fields appear in home or the session result. With every flag off, a session is the same as with only unrelated flags on (same user and level).
3. **Money under concurrency (`e2e/qa/*.api.spec.ts` or `apps/web/tests/qa/*.db.test.ts`):**
   - parallel purchases with distinct purchaseIds when the wallet covers only some: exactly `floor(balance / price)` succeed, the balance never goes negative, and the ledger sum equals the wallet;
   - the same purchaseId from two different users: independent purchases;
   - a replay after a refusal (oracle sh-15 behaviour);
   - a refill with full hearts: 409;
   - a `/complete` and a purchase for the same learner at the same moment: the wallet stays consistent.
4. **Time travel (quests and leagues):**
   - quests reset at the profile timezone's local midnight: two timezones, one of them across a DST change, with `x-test-now`; a lesson completed just before midnight counts for that day;
   - league XP lands in the week that contains `ctx.now`;
   - a rollover through `cronHeaders()` for a PAST week promotes and demotes, and pays coins exactly once (a second run pays nothing); the cron without its header, or with a wrong secret, answers 401.
   - **Isolation rule:** the local database is shared and never reset, and the rollover closes EVERY week that has ended. Only use weeks from `randomPastWeek()`, never the current or a future week, and write league assertions so that another spec's rollover closing your past week can't make them flaky. If you find that the existing engagement specs can close each other's weeks mid-test, that is a bug to report.
5. **IDOR and privacy for the new reads:**
   - `/api/leaderboard` shows only the caller's cohort and never a user id or a private field (check the raw JSON); a guest gets 403;
   - `/api/quests`, `/api/shop` and `/api/practice` only ever reflect the caller;
   - another user's purchaseId can neither reveal nor replay their purchase.
6. **Server authority.** Craft `/complete` payloads the client didn't earn, and check that the server re-grades each one:
   - a wrong typed Persian answer marked correct;
   - a trace that claims success with an empty or random stroke set, if the payload allows it.

   Record in the PR what a declined trace moves (XP, SRS, hearts, quests). If it can be farmed for XP, file it.
7. **Accessibility and RTL:**
   - axe (tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) on `/leaderboard`, `/quests`, `/shop`, `/practice`, and on the lesson with the Persian keyboard open and with the trace canvas;
   - keyboard only: answer a typed Persian challenge with the on-screen keyboard using Tab, Enter and Space;
   - every `[lang="fa"]` element has `dir="rtl"`, and no Persian word is split across elements on the new screens.
8. **Bugs:** for each real bug:
   - open a GitHub issue in srasoulj/zaboon titled `[qa] …`, labelled `bug` and `severity:blocker|major|minor`, with steps, expected vs actual, and evidence;
   - add a regression test marked `test.fail()` with a comment linking the issue (never `.skip` or `fixme`);
   - don't fix app code;
   - list the issues in the PR.

KNOWN ISSUES (already sent to their owners, who add regression tests with their fixes; don't file duplicates or write tests for them): see the list the orchestrator appends to your first message.

Tests must be deterministic: unique users and data per test, no reliance on test order or on fa-en text. Keep your new specs under about 2 minutes in total so `pnpm verify` stays in budget, and make sure they pass on a clean clone. Run the Chromium projects only (WebKit isn't installed locally; never run `playwright install`).

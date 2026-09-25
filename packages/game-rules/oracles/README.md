# Game-rule oracles (read-only)

Expected-behaviour tables, owned by the orchestrator and **read-only** (`**/oracles/**` is protected
in `ops/ownership.json`). Workers implementing `@zaboon/game-rules` (this folder) and `@zaboon/srs`
(`packages/srs/oracles/`) must make every case pass and must never edit, skip or delete a case.

Each file is a YAML list of `{id, rule, note, input, expected}`; its header comment defines each `rule`.
`expected` lists the fields the rules fix (extra result fields are allowed; arrays compare in full, in
order). Dates are `YYYY-MM-DD` strings; timestamps carry an offset or `Z` and compare as instants.
Headers and notes encode the orchestrator's 2026-09-25 rulings (e.g. practice never costs hearts).

Every case assumes these config defaults (`DEFAULT_APP_CONFIG` in `@zaboon/contracts`):

- xp: lesson 10, practice 10, letters 10, unit_review 20, legendary 40, jump_test 20; perfectBonus 5
- hearts: max 5, regenMinutes 240, practiceReward 1
- streak: maxFreezes 2, signupFreezes 1, freezeEveryDays 7
- tz: minChangeIntervalHours 24
- leagues: cohortSize 30, promote 7, demote 5; tiers (low to high) mes, noqreh, tala, firouzeh, aqiq,
  lajvard, yaqut, zomorrod, morvarid, almas
- srs: slowMs 12000

`engagement.yaml` (P2, Wave 3: league weeks and XP, rollover plan, coin grants, quests, the shop)
also assumes leagues.rewardCoins [30, 20, 10], quests.rewardCoins 10 and shop prices streak_freeze
100, heart_refill 150. Its header documents the API it calls (`src/engagement.ts`); its runner,
`engagement.oracle.test.ts`, runs the cases once `ENGAGEMENT_IMPLEMENTATION` is `'real'`.

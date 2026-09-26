# Fixture course (`fixture`)

Frozen test data for the end-to-end tests. It is not course content.

- **READ-ONLY for workers.** Tests depend on these exact ids, orders and media files.
- `u01-s0` is the first lesson on the path: four pinned challenges (select_translation, translate_bank fa→en, translate_type fa→en, match_pairs), the types the Wave 0 stub engine can build. Golden-path e2e tests use it.
- `u01-l1` pins the 8 course types in order: select_image, select_translation, translate_bank (fa→en, then en→fa), translate_type, match_pairs, listen_tap, cloze_choice, complete_chat.
- `u01-l2` pins the 5 letter types in order: letter_intro, letter_sound, letter_forms, read_word, build_word.
- Together they cover all 13 MVP challenge types. `pinnedOnly: true` means those sessions contain exactly these challenges.
- `u01-t1` (Wave 3, P2) is the LAST level on the path (after `u01-r1`), so nothing before it moves. It pins typed Persian and tracing in order: translate_type en→fa (`s_u01_0003`), listen_type (`s_u01_0005`), cloze_type (`s_u01_0007`), letter_trace (`l_be`). Its focus items all appear in the levels above, so the unit bundle and the unit review are unchanged. Until ws-typing lands the P2 builders, creating its session answers 400 (`not available yet`); its tests run with the `persianKeyboard` / `letterTrace` flags on (`x-test-flags`).
- `u01-v1` (Wave 4, P2) comes right after `u01-t1`: speak `s_u01_0001`, speak `s_u01_0007`, listen_tap `s_u01_0005`. With `flags.speak` off the speak pins play their `listen_tap` twins in place.
- `u01-st1` (Wave 4, P2, `kind: story`) comes last and plays the story `st_u01_tea` (`stories/u01-fixture.yaml`): 4 lines, 3 beats (two questions, then a closing line), using only existing lexemes, characters (leila, hodhod) and media.
- `assets/` holds tiny placeholders: sine-tone MP3s, JSON lip-sync envelopes and flat SVGs.
- Any change needs an orchestrator PR.

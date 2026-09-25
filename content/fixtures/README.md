# Fixture course (`fixture`)

Frozen test data for the end-to-end tests. It is not course content.

- **READ-ONLY for workers.** Tests depend on these exact ids, orders and media files.
- `u01-l1` pins the 8 course types in order: select_image, select_translation, translate_bank (fa→en, then en→fa), translate_type, match_pairs, listen_tap, cloze_choice, complete_chat.
- `u01-l2` pins the 5 letter types in order: letter_intro, letter_sound, letter_forms, read_word, build_word.
- Together they cover all 13 MVP challenge types. `pinnedOnly: true` means those sessions contain exactly these challenges.
- `assets/` holds tiny placeholders: sine-tone MP3s, JSON lip-sync envelopes and flat SVGs.
- Any change needs an orchestrator PR.

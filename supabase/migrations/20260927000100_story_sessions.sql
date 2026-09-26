-- P2 stories (Wave 4, ws-typing): a story level plays as a session of kind 'story'
-- (SessionKind 'story', flags.stories). Expand-only: sessions.kind's CHECK gains 'story'.
--
-- sessions.kind is the only column that lists session kinds: xp_ledger.reason (which holds the
-- session kind for base XP) has no CHECK, and level progress is keyed by level id, not kind.
--
-- The constraint is replaced under the same name. It is added NOT VALID (no scan while the
-- ACCESS EXCLUSIVE lock of the ADD is held) and then validated: every existing row holds one of
-- the old kinds, which the new list still contains, so the validation cannot fail.

ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_kind_check;
ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_kind_check CHECK (
    kind IN ('lesson', 'practice', 'letters', 'unit_review', 'legendary', 'jump_test', 'story')
  ) NOT VALID;
ALTER TABLE public.sessions VALIDATE CONSTRAINT sessions_kind_check;

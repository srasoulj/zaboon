-- Referential integrity that the isolation model and GDPR delete rely on.
BEGIN;
SET LOCAL search_path = extensions, public;
SELECT plan(5);

-- Every user-owned table cascades from profiles (so deleting an account removes everything).
SELECT is_empty(
  $$ SELECT c.table_name FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'user_id' AND c.table_name <> 'profiles'
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint k
         WHERE k.conrelid = format('public.%I', c.table_name)::regclass AND k.contype = 'f'
           AND k.confrelid = 'public.profiles'::regclass AND k.confdeltype = 'c'
           AND k.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                 WHERE attrelid = k.conrelid AND attname = 'user_id')]::int2[]) $$,
  'every user_id column references profiles ON DELETE CASCADE');

SELECT is(
  (SELECT confdeltype FROM pg_constraint
   WHERE conrelid = 'public.profiles'::regclass AND contype = 'f' AND confrelid = 'auth.users'::regclass),
  'c'::"char",
  'profiles cascade from auth.users');

-- Rows naming a session must belong to that session's owner.
SELECT set_eq(
  $$ SELECT conrelid::regclass::text FROM pg_constraint
     WHERE contype = 'f' AND confrelid = 'public.sessions'::regclass AND array_length(conkey, 1) = 2
       AND confupdtype = 'c' $$,
  ARRAY['session_events', 'session_answers', 'xp_ledger', 'reports'],
  'session children carry a (session_id, user_id) FK that follows ownership moves');

SELECT has_trigger('auth', 'users', 'zaboon_on_auth_user_created', 'auth.users insert creates the profile');

-- Idempotency keys used by the API.
SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.xp_ledger'::regclass AND contype = 'u'
          AND pg_get_constraintdef(oid) = 'UNIQUE (session_id, reason)')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.session_events'::regclass AND contype = 'p'
          AND pg_get_constraintdef(oid) = 'PRIMARY KEY (session_id, attempt_seq)'),
  'xp_ledger (session_id, reason) and session_events (session_id, attempt_seq) are unique');

SELECT * FROM finish();
ROLLBACK;

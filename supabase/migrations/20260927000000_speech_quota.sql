-- P2 speak (Wave 4, ws-typing): the per-learner daily transcription quota of
-- POST /api/speech/transcribe (AppConfig.speech.dailyQuota, 429 quota_exceeded).
-- Expand-only: one new user-owned table. It holds a counter per learner per UTC day and nothing
-- else: speech audio and transcripts are never stored (ARCHITECTURE §12).

CREATE TABLE public.speech_usage (
  user_id     uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  -- The UTC day (not the learner's local date: a quota must not reset early by changing tz).
  day         date NOT NULL,
  count       integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

-- Same model as every user-owned table (20260925000200_mvp_tables.sql): RLS on, nothing for the
-- browser's roles, app_server sees only the scoped user's rows (or everything in system scope).
ALTER TABLE public.speech_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.speech_usage FROM anon, authenticated;
CREATE POLICY app_server_own_rows ON public.speech_usage TO app_server
  USING (rls.can_access(user_id)) WITH CHECK (rls.can_access(user_id));

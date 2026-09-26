-- Defence in depth (security review): size caps the API contract already enforces, repeated in
-- the database so that no writer can store an unbounded item ref or answer.
--
--   item_ref                  at most 120 characters, on every table with an item_ref column
--                             (the contract's ItemRef allows 100; the longest real ref is 30).
--   session_answers.response  at most 8 KiB (pg_column_size, measured before compression). The
--                             largest response the contract accepts, 40 tiles of 64 three-byte
--                             characters, takes 7 884 bytes.
--
-- The constraints are NOT VALID: adding them neither scans the existing rows nor holds the
-- ACCESS EXCLUSIVE lock for long. They still apply to every row inserted or updated from now on,
-- and existing rows do get updated (the nightly rollup marks answers rolled up; an account merge
-- moves a guest's reports, and their answers by ON UPDATE CASCADE), so the rows that would fail
-- those updates are removed first. Only a crafted request could have stored one, before the
-- contract had these caps: nothing the app sends comes near them.
-- To validate the constraints later, off-peak: ALTER TABLE <table> VALIDATE CONSTRAINT <name>;

DELETE FROM public.reports WHERE char_length(item_ref) > 120;
DELETE FROM public.session_answers WHERE pg_column_size(response) > 8192;

ALTER TABLE public.mistakes
  ADD CONSTRAINT mistakes_item_ref_length CHECK (char_length(item_ref) <= 120) NOT VALID;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_item_ref_length CHECK (char_length(item_ref) <= 120) NOT VALID;
ALTER TABLE public.item_stats
  ADD CONSTRAINT item_stats_item_ref_length CHECK (char_length(item_ref) <= 120) NOT VALID;
ALTER TABLE public.session_answers
  ADD CONSTRAINT session_answers_response_size CHECK (pg_column_size(response) <= 8192) NOT VALID;

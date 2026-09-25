-- Timeouts for the route-handler role (defense in depth, ARCHITECTURE §9).
--
-- A request must never be able to park a pooled connection forever. #23 fixed a deadlock where a
-- handler inside `withUserLock` waited for a second pooled connection; these role defaults turn any
-- future bug of that class into a fast, logged error instead of a hung pool:
--
--   lock_timeout                         waits for row/table/advisory locks (withUserLock) give up
--   idle_in_transaction_session_timeout  a transaction left open by a crashed handler is closed
--   statement_timeout                    no single statement runs away
--
-- Role settings apply to new sessions only (existing pooled connections keep the old values until
-- they reconnect). `postgres` created app_server (base migration), so it holds ADMIN OPTION on it.
-- Cron, migrations and admin tooling connect as other roles and are unaffected.

ALTER ROLE app_server SET lock_timeout = '10s';
ALTER ROLE app_server SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE app_server SET statement_timeout = '15s';

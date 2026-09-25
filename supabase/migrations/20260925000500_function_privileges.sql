-- Function privileges hardening (docs/ARCHITECTURE.md §9).
--
-- Postgres grants EXECUTE on every new function to PUBLIC by default. The base migration's
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA rls|internal REVOKE EXECUTE … FROM PUBLIC` cannot remove that:
-- per-schema default privileges only add to the global defaults. So the rls helpers from the core
-- migration were executable by PUBLIC (anon/authenticated still lacked USAGE on the schema).
-- Revoke explicitly, and change the global default for functions the migration role creates.

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA rls FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA internal FROM PUBLIC, anon, authenticated, app_server;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rls TO app_server;

-- Future functions created by the migration role: no implicit PUBLIC execute anywhere. Schema
-- defaults from the base migration still grant rls/public functions to app_server.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

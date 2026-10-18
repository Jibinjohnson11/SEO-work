-- Security fix: unintended PUBLIC / anonymous EXECUTE on LinkOps functions.
--
-- PostgreSQL lets PUBLIC (every role, including anon) execute new functions by default.
-- 20261012000002_security.sql tried to switch that off with
--   alter default privileges in schema public revoke execute on functions from public, ...
-- but a per-schema default can only ADD to the database-wide default, never remove from it, so
-- that line had no effect for PUBLIC. 20261012000003_workflow.sql then revoked EXECUTE on every
-- function that existed at that point, but functions created afterwards (migrations 4, 5 and 9)
-- kept EXECUTE for PUBLIC. Every one of them checks the caller internally, so nothing was
-- readable or writable without the right role, but the database itself did not enforce it.
--
-- After this migration only explicitly granted roles can execute LinkOps functions:
--   * authenticated keeps the explicit grants given in migrations 2–9 (none relied on PUBLIC);
--   * service_role keeps its grants (Supabase's default privileges for postgres in public);
--   * anon and PUBLIC can execute nothing in public.
-- No function, table, policy or row is changed.

-- 1. Existing functions.
revoke execute on all functions in schema public from public, anon;

-- 2. Future functions created by the role that runs LinkOps migrations (postgres): database-wide,
--    PUBLIC no longer gets EXECUTE; in public, anon and authenticated get nothing unless granted
--    explicitly (as every migration already does), and service_role keeps its access.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

-- ROLLBACK for 20261021000017_brand_logos.sql. NOT a migration: run only by the reviewed procedure,
-- in ONE transaction, after confirming the database is at the post-17 state.
--
-- Deliberately NOT reverted:
--   * clients.logo_path is KEPT (nullable, ignored by the old code).
--   * The brand-logos bucket and its objects are KEPT so uploaded logos are not lost. Without the
--     policies below nobody but the service role can read or write them.

drop policy "brand logos read" on storage.objects;
drop policy "brand logos upload" on storage.objects;
drop policy "brand logos delete" on storage.objects;

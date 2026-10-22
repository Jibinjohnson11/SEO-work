-- ROLLBACK for 20261021000018_campaign_target_location.sql. NOT a migration.
--
-- Nothing to undo: campaigns.target_location is deliberately KEPT (nullable, ignored by the old code);
-- dropping it would erase the locations recorded while 18 was active.
select 1;

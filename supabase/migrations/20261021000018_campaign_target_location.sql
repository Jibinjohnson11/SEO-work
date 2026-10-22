-- Campaign target location: the city, state or country a campaign targets (free text, optional).
--
-- Additive only: existing campaigns keep target_location = NULL.
--
-- Rollback (supabase/rollbacks/20261021000018_campaign_target_location.rollback.sql) is a no-op on
-- purpose: the column is nullable and ignored by the old code, and dropping it would erase data.

alter table public.campaigns add column if not exists target_location text
  check (target_location is null or length(target_location) <= 120);

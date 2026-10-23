-- Rollback for 20261023000022_campaign_brand_immutable.sql: removes the trigger and its function.
-- Run before the rollback of 20261023000021.

drop trigger if exists campaigns_client_immutable on public.campaigns;
drop function if exists public.campaigns_client_immutable();

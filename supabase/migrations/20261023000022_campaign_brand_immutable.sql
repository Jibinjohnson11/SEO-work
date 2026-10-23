-- A campaign's brand (campaigns.client_id) can no longer change after the campaign is created.
--
-- Keywords, tasks, submissions, published backlinks and Off-Page Content all carry the campaign's brand,
-- so moving a campaign to another brand left them attached to the old one (the campaign CSV import could
-- do this by updating a campaign_code under a different client). The app never changes the brand on
-- purpose; this trigger makes the database refuse it from every path.
--
-- Additive: one trigger function and one trigger. No existing row is changed.
--
-- Rollback: supabase/rollbacks/20261023000022_campaign_brand_immutable.rollback.sql

create or replace function public.campaigns_client_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_id is distinct from old.client_id then
    raise exception 'A campaign''s brand cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists campaigns_client_immutable on public.campaigns;
create trigger campaigns_client_immutable before update of client_id on public.campaigns
  for each row execute function public.campaigns_client_immutable();

revoke execute on function public.campaigns_client_immutable() from public, anon, authenticated;

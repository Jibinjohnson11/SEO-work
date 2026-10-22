-- Client approval is the only required approval stage: internal review is switched off for every brand
-- and campaign except medical ones.
--
--   * Uses the existing settings: clients.require_internal_review is set to false, campaign overrides
--     (campaigns.require_internal_review) are cleared so campaigns follow their brand, and the
--     "approval" app setting that pre-fills the brand form becomes false. The column default stays true
--     so a brand inserted without an explicit value (e.g. a medical one) keeps the safer setting. Submitting a
--     backlink submission then goes straight to the client (or to "ready for publication" where the
--     brand does not require client approval), as the existing submit logic already does when internal
--     review is not required.
--   * Medical brands / campaigns keep the internal review they had: the medical checklist is only
--     recorded during internal review, so switching it off would skip that safety check. A medical
--     campaign under a non-medical brand gets an explicit override so it keeps its review.
--   * No workflow function, status, review record or approval decision is changed or deleted.
--     Submissions already in internal review keep their status and can still be finished from the
--     submission page.
--   * Previous values are saved in public.internal_review_setting_backup (not readable by app users) so
--     the rollback can restore them exactly.
--
-- Rollback: supabase/rollbacks/20261021000020_client_approval_only.rollback.sql

create table if not exists public.internal_review_setting_backup (
  source text not null check (source in ('clients', 'campaigns', 'application_settings')),
  row_key text not null,
  previous jsonb,
  saved_at timestamptz not null default now(),
  primary key (source, row_key)
);
alter table public.internal_review_setting_backup enable row level security;
revoke all on public.internal_review_setting_backup from anon, authenticated;

insert into public.internal_review_setting_backup (source, row_key, previous)
select 'clients', id::text, to_jsonb(require_internal_review) from public.clients
on conflict do nothing;
insert into public.internal_review_setting_backup (source, row_key, previous)
select 'campaigns', id::text, to_jsonb(require_internal_review) from public.campaigns
on conflict do nothing;
insert into public.internal_review_setting_backup (source, row_key, previous)
select 'application_settings', key, value -> 'internal_review_required' from public.application_settings
where key = 'approval' and value ? 'internal_review_required'
on conflict do nothing;

-- Medical campaigns that inherit review from a non-medical brand keep it explicitly.
update public.campaigns c set require_internal_review = true
  from public.clients cl
  where cl.id = c.client_id and c.require_internal_review is null and cl.require_internal_review
    and not cl.is_medical and coalesce(c.is_medical, cl.is_medical);
-- Non-medical campaigns follow their brand.
update public.campaigns c set require_internal_review = null
  from public.clients cl
  where cl.id = c.client_id and c.require_internal_review is not null and not coalesce(c.is_medical, cl.is_medical);
update public.clients set require_internal_review = false where require_internal_review and not is_medical;
update public.application_settings set value = jsonb_set(value, '{internal_review_required}', 'false')
  where key = 'approval';

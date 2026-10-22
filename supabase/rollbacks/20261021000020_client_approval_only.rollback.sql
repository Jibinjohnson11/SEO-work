-- Rollback for 20261021000020_client_approval_only.sql: restores every brand's and campaign's previous
-- internal review setting and the "approval" app setting from the backup. Brands created after the migration keep their current value. The backup table is kept
-- (it is not readable by app users).

update public.clients c set require_internal_review = (b.previous)::boolean
  from public.internal_review_setting_backup b
  where b.source = 'clients' and b.row_key = c.id::text;
update public.campaigns c set require_internal_review = (b.previous)::boolean
  from public.internal_review_setting_backup b
  where b.source = 'campaigns' and b.row_key = c.id::text;
update public.application_settings s set value = jsonb_set(s.value, '{internal_review_required}', b.previous)
  from public.internal_review_setting_backup b
  where b.source = 'application_settings' and b.row_key = s.key and b.previous is not null;

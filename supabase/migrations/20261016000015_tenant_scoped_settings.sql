-- Security fix: cross-tenant reads through two SECURITY DEFINER helpers.
--
-- campaign_flags(campaign) and client_portal_settings(client) are executable by every signed-in
-- user (the app and several workflow functions call them), and they returned the workflow flags /
-- portal visibility settings of ANY campaign or client whose id the caller supplied. No submission,
-- contact or report data was exposed, but one tenant could read another tenant's configuration.
--
-- Both now answer only for a tenant the caller may see; for anyone else campaign_flags returns no
-- row and client_portal_settings returns NULL (policies and functions treat that as "not shown"):
--   * the Super Admin, and trusted backend contexts (service role: the daily job; SQL editor);
--   * client users: their own workspace (my_client_ids());
--   * interns: campaigns assigned to them (my_campaign_ids()), or campaigns where they have their
--     own submission, so historical work stays viewable after reassignment.
-- Signatures, return types and grants are unchanged (create or replace keeps the ACL).

create or replace function public.campaign_flags(p_campaign_id uuid)
returns table (is_medical boolean, require_internal_review boolean, require_client_approval boolean,
               reapproval_on_material_change boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(c.is_medical, cl.is_medical),
         coalesce(c.require_internal_review, cl.require_internal_review),
         coalesce(c.require_client_approval, cl.require_client_approval),
         cl.reapproval_on_material_change
  from public.campaigns c
  join public.clients cl on cl.id = c.client_id
  where c.id = p_campaign_id
    and (public.is_super_admin()
         or public.is_trusted_backend()
         or c.id in (select public.my_campaign_ids())
         or c.client_id in (select public.my_client_ids())
         or exists (select 1 from public.backlink_submissions s
                    where s.campaign_id = c.id and s.intern_id = auth.uid() and public.auth_role() = 'intern'))
$$;

create or replace function public.client_portal_settings(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_super_admin()
      or public.is_trusted_backend()
      or p_client_id in (select public.my_client_ids())
      or exists (select 1 from public.campaigns c
                 where c.client_id = p_client_id and c.id in (select public.my_campaign_ids()))
      or exists (select 1 from public.backlink_submissions s
                 where s.client_id = p_client_id and s.intern_id = auth.uid() and public.auth_role() = 'intern')
    then jsonb_build_object(
      'show_campaign_progress', true,
      'show_published_backlinks', true,
      'show_reports', true,
      'allow_report_download', true,
      'show_intern_names', false,
      'show_domain_metrics', true,
      'show_target_counts', true
    ) || coalesce((select c.portal_settings from public.clients c where c.id = p_client_id), '{}'::jsonb)
  end
$$;

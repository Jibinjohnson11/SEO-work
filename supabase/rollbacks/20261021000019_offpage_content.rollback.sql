-- Rollback for 20261021000019_offpage_content.sql.
-- Removes the module only while it holds no content; otherwise stops so nothing is erased
-- (the old code ignores these tables, so keeping them is safe).

do $$
begin
  if exists (select 1 from public.offpage_contents) then
    raise exception 'offpage_contents has rows; keeping the module (it is ignored by the old code)';
  end if;
  drop function if exists public.client_portal_offpage_content(uuid);
  drop function if exists public.client_portal_offpage_contents(boolean);
  drop function if exists public.offpage_content_client_decision(uuid, public.review_decision, text, integer);
  drop function if exists public.offpage_content_submit(uuid, jsonb);
  drop table public.offpage_content_decisions;
  drop table public.offpage_content_versions;
  drop table public.offpage_contents;
  drop function if exists public.offpage_contents_derive_client();
  drop function if exists public.offpage_history_immutable();
  drop sequence if exists public.offpage_content_code_seq;
  update public.role_permissions set features = array_remove(features, 'intern.content') where role = 'intern';
end;
$$;

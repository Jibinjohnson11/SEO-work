-- Self-registration, admin approval and feature-level permissions.
--
-- * Sign-ups create a 'pending' profile with no role. auth_role() only resolves for 'active'
--   profiles, so every existing RLS policy and RPC already denies pending/rejected users.
-- * A Super Admin approves a registration by assigning a role (intern or client) and the
--   features that user may use. Features are keys such as 'intern.tasks' or 'portal.reports';
--   the catalog lives in src/lib/permissions.ts and must match the seed below.
-- * profiles.permissions NULL = follow the role's defaults (public.role_permissions);
--   an array = an explicit per-user list. Super Admins always have every feature.

-- ---------------------------------------------------------------------------
-- Profiles: pending users have no role yet; per-user permission overrides
-- ---------------------------------------------------------------------------
alter table public.profiles alter column role drop not null;
alter table public.profiles
  add constraint profiles_role_required check (role is not null or status in ('pending', 'rejected'));
alter table public.profiles add column permissions text[];
comment on column public.profiles.permissions is
  'Feature keys this user may use. NULL = the role defaults in public.role_permissions.';

grant update (permissions) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Default features per role (editable by the Super Admin)
-- ---------------------------------------------------------------------------
create table public.role_permissions (
  role public.app_role primary key check (role <> 'super_admin'),
  features text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create trigger role_permissions_updated_at before update on public.role_permissions
  for each row execute function public.set_updated_at();
create trigger role_permissions_audit after insert or update or delete on public.role_permissions
  for each row execute function public.audit_row_change();

-- Existing (invited) users keep the access they have today: every feature of their role.
insert into public.role_permissions (role, features) values
  ('intern', '{intern.dashboard,intern.tasks,intern.campaigns,intern.submissions,intern.submissions.manage,intern.performance,intern.notifications}'),
  ('client', '{portal.overview,portal.approvals,portal.approvals.decide,portal.campaigns,portal.published,portal.reports,portal.reports.download,portal.notifications}')
on conflict (role) do nothing;

alter table public.role_permissions enable row level security;
create policy role_permissions_admin on public.role_permissions for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
grant select, update on public.role_permissions to authenticated;

-- ---------------------------------------------------------------------------
-- Permission helpers
-- ---------------------------------------------------------------------------
-- Effective features of the signed-in user: '{*}' for an active Super Admin, '{}' for anyone
-- who is not active. Keys outside the user's role namespace are ignored.
create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when p.role = 'super_admin' then array['*']
      else array(
        select f
        from unnest(coalesce(p.permissions, (select rp.features from public.role_permissions rp where rp.role = p.role), '{}')) f
        where split_part(f, '.', 1) = case p.role when 'intern' then 'intern' when 'client' then 'portal' end
      )
    end
    from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.role is not null
  ), '{}')
$$;

create or replace function public.has_permission(p_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select '*' = any(public.my_permissions()) or p_feature = any(public.my_permissions())
$$;

create or replace function public._require_permission(p_features text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mine text[] := public.my_permissions();
begin
  if not ('*' = any(v_mine) or v_mine && p_features) then
    raise exception 'Your account does not have access to this feature' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile protection (replaces 20261012000002): null-safe role checks, roles are assigned once
-- at approval, and permissions are Super Admin-only like role and status.
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_trusted_backend() then
    return new;
  end if;

  if new.id is distinct from old.id or new.email is distinct from old.email
     or new.created_by is distinct from old.created_by then
    raise exception 'Identity fields cannot be changed' using errcode = '42501';
  end if;

  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.permissions is distinct from old.permissions
     or new.daily_target is distinct from old.daily_target
     or new.weekly_target is distinct from old.weekly_target
     or new.monthly_target is distinct from old.monthly_target
     or new.joining_date is distinct from old.joining_date then
    if not public.is_super_admin() then
      raise exception 'Only a Super Admin can change role, status, permissions or targets' using errcode = '42501';
    end if;
    if new.role is distinct from old.role then
      if new.role = 'super_admin' then
        raise exception 'The Super Admin role can only be granted by a database administrator' using errcode = '42501';
      end if;
      if old.role = 'super_admin' then
        raise exception 'Super Admin accounts cannot be demoted from the application' using errcode = '42501';
      end if;
      if old.role is not null then
        raise exception 'A role is assigned once, when the account is approved' using errcode = '42501';
      end if;
    end if;
    if old.id = auth.uid() and new.status is distinct from 'active' then
      raise exception 'You cannot disable your own account' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sign-up: the app's sign-up form marks the auth user with self_signup = true. Such users get
-- a pending profile with no role; every other auth user (invites, bootstrap) is unaffected.
-- ---------------------------------------------------------------------------
create or replace function public.handle_self_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120);
begin
  if coalesce(new.raw_user_meta_data ->> 'self_signup', '') <> 'true' or new.email is null then
    return new;
  end if;
  insert into public.profiles (id, email, full_name, role, status)
  values (new.id, lower(new.email), v_name, null, 'pending')
  on conflict do nothing;
  if found then
    perform public.notify_admins('registration.pending', 'New account awaiting approval',
      coalesce(nullif(v_name, ''), lower(new.email)) || ' registered and is waiting for access.',
      '/admin/users?status=pending', 'profile', new.id, 'registration:' || new.id::text);
  end if;
  return new;
end;
$$;
create trigger on_auth_user_created_self_signup after insert on auth.users
  for each row execute function public.handle_self_signup();

-- ---------------------------------------------------------------------------
-- Approval: one transaction for the profile, workspace membership and campaign assignments.
-- Audit triggers record the Super Admin (auth.uid()) as the actor.
-- ---------------------------------------------------------------------------
create or replace function public.approve_registration(
  p_user_id uuid,
  p_role public.app_role,
  p_permissions text[],
  p_client_id uuid default null,
  p_can_approve boolean default true,
  p_can_download_reports boolean default true,
  p_campaign_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can approve accounts' using errcode = '42501';
  end if;
  if p_role not in ('intern', 'client') then
    raise exception 'Approved accounts can be interns or clients' using errcode = '22023';
  end if;
  select * into p from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  if p.status not in ('pending', 'rejected') then
    raise exception 'This account has already been reviewed' using errcode = '22023';
  end if;
  if p_role = 'client' and p_client_id is null then
    raise exception 'Choose the client workspace for this user' using errcode = '22023';
  end if;

  update public.profiles
    set role = p_role, status = 'active', permissions = p_permissions
    where id = p_user_id;

  if p_role = 'client' then
    insert into public.client_members (client_id, user_id, can_approve, can_download_reports)
    values (p_client_id, p_user_id, p_can_approve, p_can_download_reports)
    on conflict (client_id, user_id) do update
      set can_approve = excluded.can_approve, can_download_reports = excluded.can_download_reports;
  elsif coalesce(array_length(p_campaign_ids, 1), 0) > 0 then
    insert into public.intern_assignments (campaign_id, intern_id, assigned_by)
    select c, p_user_id, auth.uid() from unnest(p_campaign_ids) c
    on conflict (campaign_id, intern_id) do update set is_active = true;
  end if;

  perform public.notify(p_user_id, 'registration.approved', 'Your account has been approved',
    'You can now use the features your administrator enabled for you.', '/', 'profile', p_user_id,
    'registration-approved:' || p_user_id::text || ':' || extract(epoch from now())::bigint);
end;
$$;

-- ---------------------------------------------------------------------------
-- Database-level feature checks for the RPCs behind each feature. The original functions are
-- kept as private *_impl versions; the public names (unchanged signatures) check first.
-- ---------------------------------------------------------------------------
alter function public.submission_save(uuid, jsonb, boolean) rename to _submission_save_impl;
create function public.submission_save(p_id uuid, p_data jsonb, p_submit boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_permission(array['intern.submissions.manage']);
  return public._submission_save_impl(p_id, p_data, p_submit);
end;
$$;

alter function public.task_set_status(uuid, public.task_status) rename to _task_set_status_impl;
create function public.task_set_status(p_task_id uuid, p_status public.task_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_permission(array['intern.tasks']);
  perform public._task_set_status_impl(p_task_id, p_status);
end;
$$;

alter function public.submission_record_publication(uuid, text, date, public.link_attribute, text)
  rename to _submission_record_publication_impl;
create function public.submission_record_publication(
  p_id uuid, p_published_url text, p_publication_date date, p_link_attribute public.link_attribute,
  p_anchor_text text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_permission(array['intern.submissions.manage']);
  return public._submission_record_publication_impl(p_id, p_published_url, p_publication_date, p_link_attribute, p_anchor_text);
end;
$$;

alter function public.submission_add_file(uuid, text, text, text, bigint) rename to _submission_add_file_impl;
create function public.submission_add_file(
  p_submission_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_permission(array['intern.submissions.manage']);
  return public._submission_add_file_impl(p_submission_id, p_storage_path, p_file_name, p_mime_type, p_size_bytes);
end;
$$;

alter function public.submission_remove_file(uuid) rename to _submission_remove_file_impl;
create function public.submission_remove_file(p_file_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_permission(array['intern.submissions.manage']);
  return public._submission_remove_file_impl(p_file_id);
end;
$$;

alter function public.submission_client_decision(uuid, public.review_decision, text, integer)
  rename to _submission_client_decision_impl;
create function public.submission_client_decision(
  p_id uuid, p_decision public.review_decision, p_feedback text, p_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_permission(array['portal.approvals.decide']);
  perform public._submission_client_decision_impl(p_id, p_decision, p_feedback, p_version);
end;
$$;

-- Client portal reads
alter function public.client_portal_campaigns() rename to _client_portal_campaigns_impl;
create function public.client_portal_campaigns()
returns table (
  id uuid, code text, name text, client_id uuid, client_name text, status public.campaign_status,
  priority public.priority_level, start_date date, end_date date, target_url text, monthly_target integer,
  primary_keyword text, keywords text[], month_submitted integer, month_client_approved integer,
  month_published integer, month_verified integer, awaiting_approval integer, total_published integer,
  total_verified integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_client();
  perform public._require_permission(array['portal.overview', 'portal.campaigns']);
  return query select * from public._client_portal_campaigns_impl();
end;
$$;

alter function public.client_portal_submissions(boolean) rename to _client_portal_submissions_impl;
create function public.client_portal_submissions(p_queue_only boolean default false)
returns table (
  id uuid, code text, client_id uuid, campaign_code text, campaign_name text, keyword text, backlink_type text,
  proposed_website text, placement_url text, target_url text, anchor_text text, content_title text,
  status public.submission_status, current_version integer, client_approved_version integer,
  submitted_at timestamptz, sent_to_client_at timestamptz, last_decision public.review_decision,
  last_decision_at timestamptz, domain_rating numeric, domain_authority numeric, intern_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_client();
  perform public._require_permission(array['portal.overview', 'portal.approvals']);
  return query select * from public._client_portal_submissions_impl(p_queue_only);
end;
$$;

alter function public.client_portal_submission(uuid) rename to _client_portal_submission_impl;
create function public.client_portal_submission(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_client();
  perform public._require_permission(array['portal.approvals']);
  return public._client_portal_submission_impl(p_id);
end;
$$;

alter function public.client_portal_published() rename to _client_portal_published_impl;
create function public.client_portal_published()
returns table (
  id uuid, submission_code text, campaign_code text, campaign_name text, backlink_type text, published_url text,
  publisher_domain text, target_url text, anchor_text text, link_attribute public.link_attribute,
  publication_date date, live_status public.live_status, last_checked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_client();
  perform public._require_permission(array['portal.overview', 'portal.published']);
  return query select * from public._client_portal_published_impl();
end;
$$;

-- Published reports are visible to client users only with the Reports feature.
drop policy reports_client_read on public.reports;
create policy reports_client_read on public.reports for select to authenticated
  using (status = 'published'
         and client_id in (select public.my_client_ids())
         and (public.client_portal_settings(client_id) ->> 'show_reports')::boolean
         and public.has_permission('portal.reports'));

-- ---------------------------------------------------------------------------
-- Grants. Renamed functions keep their old grants, so revoke them: only the checked wrappers
-- are callable by signed-in users.
-- ---------------------------------------------------------------------------
revoke execute on function
  public._submission_save_impl(uuid, jsonb, boolean),
  public._task_set_status_impl(uuid, public.task_status),
  public._submission_record_publication_impl(uuid, text, date, public.link_attribute, text),
  public._submission_add_file_impl(uuid, text, text, text, bigint),
  public._submission_remove_file_impl(uuid),
  public._submission_client_decision_impl(uuid, public.review_decision, text, integer),
  public._client_portal_campaigns_impl(),
  public._client_portal_submissions_impl(boolean),
  public._client_portal_submission_impl(uuid),
  public._client_portal_published_impl(),
  public._require_permission(text[]),
  public.handle_self_signup()
from public, anon, authenticated;

grant execute on function
  public.my_permissions(), public.has_permission(text),
  public.approve_registration(uuid, public.app_role, text[], uuid, boolean, boolean, uuid[]),
  public.submission_save(uuid, jsonb, boolean), public.task_set_status(uuid, public.task_status),
  public.submission_record_publication(uuid, text, date, public.link_attribute, text),
  public.submission_add_file(uuid, text, text, text, bigint), public.submission_remove_file(uuid),
  public.submission_client_decision(uuid, public.review_decision, text, integer),
  public.client_portal_campaigns(), public.client_portal_submissions(boolean),
  public.client_portal_submission(uuid), public.client_portal_published()
to authenticated;

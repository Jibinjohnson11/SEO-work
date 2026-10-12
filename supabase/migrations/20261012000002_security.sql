-- Authorization helpers, Row Level Security, grants and audit triggers.

-- New objects are private until explicitly granted below / in later migrations.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Identity helpers (SECURITY DEFINER so policies can read profiles without recursion)
-- ---------------------------------------------------------------------------
create or replace function public.auth_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.status = 'active'
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() = 'super_admin', false)
$$;

-- True for trusted backend contexts (service-role API calls, migrations, SQL editor). Uses the
-- session role setting because current_user inside SECURITY DEFINER functions is the owner.
create or replace function public.is_trusted_backend()
returns boolean
language sql
stable
as $$
  select coalesce(nullif(current_setting('role', true), ''), 'none') not in ('anon', 'authenticated')
$$;

create or replace function public.my_client_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cm.client_id
  from public.client_members cm
  join public.profiles p on p.id = cm.user_id
  where cm.user_id = auth.uid() and p.status = 'active' and p.role = 'client'
$$;

create or replace function public.my_campaign_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ia.campaign_id
  from public.intern_assignments ia
  join public.profiles p on p.id = ia.intern_id
  where ia.intern_id = auth.uid() and ia.is_active and p.status = 'active' and p.role = 'intern'
$$;

create or replace function public.is_my_submission(p_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.backlink_submissions s
    join public.profiles p on p.id = s.intern_id
    where s.id = p_submission_id and s.intern_id = auth.uid() and p.status = 'active'
  )
$$;

-- Effective portal visibility for a client (defaults merged with per-client overrides).
create or replace function public.client_portal_settings(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'show_campaign_progress', true,
    'show_published_backlinks', true,
    'show_reports', true,
    'allow_report_download', true,
    'show_intern_names', false,
    'show_domain_metrics', true,
    'show_target_counts', true
  ) || coalesce((select c.portal_settings from public.clients c where c.id = p_client_id), '{}'::jsonb)
$$;

-- ---------------------------------------------------------------------------
-- Profile protection: privileged columns change only via Super Admin, and the
-- super_admin role can never be granted from the application.
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Trusted backend roles (migrations, service role used by invite/bootstrap scripts).
  if public.is_trusted_backend() then
    return new;
  end if;

  if new.id is distinct from old.id or new.email is distinct from old.email
     or new.created_by is distinct from old.created_by then
    raise exception 'Identity fields cannot be changed' using errcode = '42501';
  end if;

  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.daily_target is distinct from old.daily_target
     or new.weekly_target is distinct from old.weekly_target
     or new.monthly_target is distinct from old.monthly_target
     or new.joining_date is distinct from old.joining_date then
    if not public.is_super_admin() then
      raise exception 'Only a Super Admin can change role, status or targets' using errcode = '42501';
    end if;
    if new.role = 'super_admin' and old.role <> 'super_admin' then
      raise exception 'The Super Admin role can only be granted by a database administrator' using errcode = '42501';
    end if;
    if old.role = 'super_admin' and new.role <> 'super_admin' then
      raise exception 'Super Admin accounts cannot be demoted from the application' using errcode = '42501';
    end if;
    if old.id = auth.uid() and new.status <> 'active' then
      raise exception 'You cannot disable your own account' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile();

-- ---------------------------------------------------------------------------
-- Audit logging (append-only)
-- ---------------------------------------------------------------------------
create or replace function public.log_activity(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_client_id uuid,
  p_summary text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.activity_logs (actor_id, actor_role, action, entity_type, entity_id, client_id, summary, metadata)
  values (auth.uid(), public.auth_role(), p_action, p_entity_type, p_entity_id, p_client_id, p_summary,
          coalesce(p_metadata, '{}'::jsonb));
end;
$$;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_client uuid;
  v_entity text;
begin
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      continue when v_key in ('updated_at');
      if v_new -> v_key is distinct from v_old -> v_key then
        v_val := v_new -> v_key;
        -- Keep the log compact: long text and JSON blobs are recorded as changed, not copied.
        if jsonb_typeof(v_val) in ('object', 'array')
           or (jsonb_typeof(v_val) = 'string' and length(v_val #>> '{}') > 300) then
          v_val := '"(changed)"'::jsonb;
        end if;
        v_changed := v_changed || jsonb_build_object(v_key, v_val);
      end if;
    end loop;
    if v_changed = '{}'::jsonb then
      return null;
    end if;
  end if;

  v_entity := coalesce(v_row ->> 'id', v_row ->> 'key',
                       concat_ws(':', v_row ->> 'campaign_id', v_row ->> 'keyword_id', v_row ->> 'backlink_type_id'));
  v_client := case
    when tg_table_name = 'clients' then (v_row ->> 'id')::uuid
    when v_row ? 'client_id' then (v_row ->> 'client_id')::uuid
    else null
  end;

  insert into public.activity_logs (actor_id, actor_role, action, entity_type, entity_id, client_id, summary, metadata)
  values (
    auth.uid(),
    public.auth_role(),
    lower(tg_op),
    tg_table_name,
    v_entity,
    v_client,
    coalesce(v_row ->> 'code', v_row ->> 'name', v_row ->> 'company_name', v_row ->> 'keyword',
             v_row ->> 'title', v_row ->> 'email', v_row ->> 'key'),
    case when tg_op = 'UPDATE' then jsonb_build_object('changed', v_changed) else '{}'::jsonb end
  );
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'clients', 'client_members', 'campaigns', 'keywords', 'campaign_keywords',
    'campaign_backlink_types', 'backlink_types', 'intern_assignments', 'tasks',
    'backlink_submissions', 'published_backlinks', 'application_settings', 'reports'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()',
      t || '_audit', t);
  end loop;
end;
$$;

create or replace function public.prevent_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Activity logs are append-only' using errcode = '42501';
end;
$$;
create trigger activity_logs_immutable before update or delete on public.activity_logs
  for each row execute function public.prevent_log_mutation();
create trigger submission_events_immutable before update or delete on public.submission_events
  for each row execute function public.prevent_log_mutation();

-- ---------------------------------------------------------------------------
-- Submission status events (source of truth for timestamp-based reporting)
-- ---------------------------------------------------------------------------
create or replace function public.record_submission_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.submission_events (submission_id, from_status, to_status, version, actor_id, note)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, new.current_version,
            auth.uid(), nullif(current_setting('linkops.transition_note', true), ''));
  end if;
  return null;
end;
$$;
create trigger backlink_submissions_events after insert or update of status on public.backlink_submissions
  for each row execute function public.record_submission_event();

-- ---------------------------------------------------------------------------
-- Grants. Supabase grants broad defaults to anon/authenticated; reset them explicitly.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to authenticated;

-- Read access (rows filtered by RLS below)
grant select on
  public.roles, public.profiles, public.clients, public.client_members, public.campaigns, public.keywords,
  public.campaign_keywords, public.campaign_backlink_types, public.backlink_types, public.intern_assignments,
  public.tasks, public.backlink_submissions, public.submission_versions, public.submission_files,
  public.submission_events, public.internal_reviews, public.client_approvals, public.published_backlinks,
  public.verification_checks, public.notifications, public.activity_logs, public.application_settings,
  public.reports, public.saved_filters
to authenticated;

-- Direct writes (admin-configured entities; RLS restricts to Super Admin). Workflow tables
-- (submissions, reviews, approvals, publication, verification) are written only through RPCs.
grant insert, update, delete on
  public.clients, public.client_members, public.campaigns, public.keywords, public.campaign_keywords,
  public.campaign_backlink_types, public.backlink_types, public.intern_assignments, public.tasks,
  public.application_settings, public.reports, public.saved_filters
to authenticated;
grant update (full_name, phone, job_title, avatar_url, timezone, email_notifications,
              role, status, daily_target, weekly_target, monthly_target, joining_date)
  on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant usage on all sequences in schema public to authenticated;

grant execute on function
  public.auth_role(), public.is_super_admin(), public.my_client_ids(), public.my_campaign_ids(),
  public.is_my_submission(uuid), public.client_portal_settings(uuid), public.is_trusted_backend()
to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.client_members enable row level security;
alter table public.campaigns enable row level security;
alter table public.keywords enable row level security;
alter table public.campaign_keywords enable row level security;
alter table public.campaign_backlink_types enable row level security;
alter table public.backlink_types enable row level security;
alter table public.intern_assignments enable row level security;
alter table public.tasks enable row level security;
alter table public.backlink_submissions enable row level security;
alter table public.submission_versions enable row level security;
alter table public.submission_files enable row level security;
alter table public.submission_events enable row level security;
alter table public.internal_reviews enable row level security;
alter table public.client_approvals enable row level security;
alter table public.published_backlinks enable row level security;
alter table public.verification_checks enable row level security;
alter table public.notifications enable row level security;
alter table public.activity_logs enable row level security;
alter table public.application_settings enable row level security;
alter table public.reports enable row level security;
alter table public.saved_filters enable row level security;
alter table public.rate_limits enable row level security;

-- roles / backlink types / settings: readable by any active user
create policy roles_read on public.roles for select to authenticated using (public.auth_role() is not null);
create policy backlink_types_read on public.backlink_types for select to authenticated
  using (public.auth_role() is not null);
create policy backlink_types_admin on public.backlink_types for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy settings_read on public.application_settings for select to authenticated
  using (public.auth_role() is not null);
create policy settings_admin on public.application_settings for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- profiles
create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_admin_read on public.profiles for select to authenticated using (public.is_super_admin());
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- clients
create policy clients_admin on public.clients for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy clients_intern_read on public.clients for select to authenticated
  using (id in (select c.client_id from public.campaigns c where c.id in (select public.my_campaign_ids())));
-- Client users read their workspace through client_portal_* functions, not this table.

create policy client_members_admin on public.client_members for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy client_members_self_read on public.client_members for select to authenticated
  using (user_id = auth.uid());

-- campaigns & keywords
create policy campaigns_admin on public.campaigns for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy campaigns_intern_read on public.campaigns for select to authenticated
  using (id in (select public.my_campaign_ids()));

create policy keywords_admin on public.keywords for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy keywords_intern_read on public.keywords for select to authenticated
  using (id in (select ck.keyword_id from public.campaign_keywords ck
                where ck.campaign_id in (select public.my_campaign_ids())));

create policy campaign_keywords_admin on public.campaign_keywords for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy campaign_keywords_intern_read on public.campaign_keywords for select to authenticated
  using (campaign_id in (select public.my_campaign_ids()));

create policy campaign_types_admin on public.campaign_backlink_types for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy campaign_types_intern_read on public.campaign_backlink_types for select to authenticated
  using (campaign_id in (select public.my_campaign_ids()));

-- assignments & tasks
create policy assignments_admin on public.intern_assignments for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy assignments_self_read on public.intern_assignments for select to authenticated
  using (intern_id = auth.uid() and public.auth_role() = 'intern');

create policy tasks_admin on public.tasks for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy tasks_intern_read on public.tasks for select to authenticated
  using (intern_id = auth.uid() and public.auth_role() = 'intern');

-- submissions and children: interns see only their own; clients use portal functions
create policy submissions_admin_read on public.backlink_submissions for select to authenticated
  using (public.is_super_admin());
create policy submissions_intern_read on public.backlink_submissions for select to authenticated
  using (intern_id = auth.uid() and public.auth_role() = 'intern');

create policy versions_admin_read on public.submission_versions for select to authenticated
  using (public.is_super_admin());
create policy versions_intern_read on public.submission_versions for select to authenticated
  using (public.is_my_submission(submission_id));

create policy files_admin_read on public.submission_files for select to authenticated
  using (public.is_super_admin());
create policy files_intern_read on public.submission_files for select to authenticated
  using (public.is_my_submission(submission_id));

create policy events_admin_read on public.submission_events for select to authenticated
  using (public.is_super_admin());
create policy events_intern_read on public.submission_events for select to authenticated
  using (public.is_my_submission(submission_id));

create policy internal_reviews_admin_read on public.internal_reviews for select to authenticated
  using (public.is_super_admin());
create policy internal_reviews_intern_read on public.internal_reviews for select to authenticated
  using (public.is_my_submission(submission_id));

create policy client_approvals_admin_read on public.client_approvals for select to authenticated
  using (public.is_super_admin());
create policy client_approvals_intern_read on public.client_approvals for select to authenticated
  using (public.is_my_submission(submission_id));
create policy client_approvals_client_read on public.client_approvals for select to authenticated
  using (client_id in (select public.my_client_ids()));

create policy published_admin_read on public.published_backlinks for select to authenticated
  using (public.is_super_admin());
create policy published_intern_read on public.published_backlinks for select to authenticated
  using (intern_id = auth.uid() and public.auth_role() = 'intern');

create policy checks_admin_read on public.verification_checks for select to authenticated
  using (public.is_super_admin());
create policy checks_intern_read on public.verification_checks for select to authenticated
  using (published_backlink_id in (select pb.id from public.published_backlinks pb where pb.intern_id = auth.uid()));

-- notifications
create policy notifications_own_read on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_own_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- activity logs: Super Admin only, read-only
create policy activity_admin_read on public.activity_logs for select to authenticated
  using (public.is_super_admin());

-- reports: admin manages; clients read published reports for their workspace if allowed
create policy reports_admin on public.reports for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy reports_client_read on public.reports for select to authenticated
  using (status = 'published'
         and client_id in (select public.my_client_ids())
         and (public.client_portal_settings(client_id) ->> 'show_reports')::boolean);

-- saved filters: own rows
create policy saved_filters_own on public.saved_filters for all to authenticated
  using (user_id = auth.uid() and public.auth_role() is not null)
  with check (user_id = auth.uid() and public.auth_role() is not null);

-- rate_limits: no policies -> only reachable through check_rate_limit()

-- Called after each successful sign-in: records the access log and activates invited users
-- (accepting the emailed invite proves ownership of the address). Disabled users stay disabled.
create or replace function public.record_sign_in()
returns public.app_role
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles;
begin
  update public.profiles
    set last_sign_in_at = now(),
        status = case when status = 'invited' then 'active'::public.user_status else status end
    where id = auth.uid()
    returning * into p;
  if not found then
    return null;
  end if;
  insert into public.activity_logs (actor_id, actor_role, action, entity_type, entity_id, summary)
  values (p.id, p.role, 'auth.sign_in', 'profiles', p.id::text, p.email);
  return case when p.status = 'active' then p.role end;
end;
$$;
grant execute on function public.record_sign_in() to authenticated;

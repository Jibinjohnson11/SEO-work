-- Off-Page Content: content prepared for a campaign keyword before any backlink is published, approved
-- by the client (the only approval stage for content).
--
--   Off-Page Content → Client Approval → Backlink Publication → Verification
--
--   * offpage_contents: one row per piece of content; status is driven by the functions below:
--       awaiting_client_approval → approved | changes_requested | rejected
--       changes_requested → (author edits and resubmits) → awaiting_client_approval
--     approved and rejected are final, so only the approved version ever proceeds to publication.
--   * offpage_content_versions / offpage_content_decisions: append-only history of every submitted
--     version and every client decision (with feedback and timestamps).
--   * Separate from backlink_submissions: nothing here creates, reviews or publishes a backlink, and the
--     existing submission review / client approval workflow is untouched.
--   * client_id follows the campaign; keyword_id must be one of the campaign's keywords
--     (public.campaign_keywords). Several contents may share a campaign and keyword.
--   * content_html is sanitized by the server action and again when it is displayed.
--   * Access: Super Admins see everything. Team members need the new "intern.content" feature (added to
--     the intern role defaults) and see only their own content, for campaigns they are assigned to.
--     Client users read and decide through the client_portal_* functions (portal.approvals[.decide]) and
--     only when they may approve for that brand. All writes go through the functions.
--   * content_type / status values are kept in sync with src/lib/offpage-content.ts.
--
-- Additive only: new tables and functions; the only change to existing data is adding "intern.content"
-- to the intern role defaults.
--
-- Rollback (supabase/rollbacks/20261021000019_offpage_content.rollback.sql) drops the module only while
-- it holds no content, so saved content and its history are never erased by a rollback.

-- 1. Tables -------------------------------------------------------------------------------------------
create sequence if not exists public.offpage_content_code_seq;
create table if not exists public.offpage_contents (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('CNT-' || lpad(nextval('public.offpage_content_code_seq')::text, 5, '0')),
  client_id uuid not null references public.clients (id) on delete restrict,
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  keyword_id uuid not null references public.keywords (id) on delete restrict,
  backlink_type_id uuid not null references public.backlink_types (id) on delete restrict,
  content_type text not null
    check (content_type in ('blog', 'article', 'description', 'social_bookmarking', 'business_listing')),
  title text not null check (length(btrim(title)) between 1 and 200),
  content_html text not null check (length(content_html) between 1 and 200000),
  status text not null default 'awaiting_client_approval'
    check (status in ('awaiting_client_approval', 'changes_requested', 'approved', 'rejected')),
  current_version integer not null default 1 check (current_version >= 1),
  approved_version integer check (approved_version is null or approved_version between 1 and current_version),
  submitted_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  updated_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists offpage_contents_campaign_idx on public.offpage_contents (campaign_id);
create index if not exists offpage_contents_keyword_idx on public.offpage_contents (keyword_id);
create index if not exists offpage_contents_author_idx on public.offpage_contents (submitted_by);
create index if not exists offpage_contents_queue_idx on public.offpage_contents (client_id, status);
create index if not exists offpage_contents_created_idx on public.offpage_contents (created_at desc);

create table if not exists public.offpage_content_versions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.offpage_contents (id) on delete restrict,
  version integer not null check (version >= 1),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  keyword_id uuid not null references public.keywords (id) on delete restrict,
  backlink_type_id uuid not null references public.backlink_types (id) on delete restrict,
  content_type text not null,
  title text not null,
  content_html text not null,
  submitted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (content_id, version)
);

create table if not exists public.offpage_content_decisions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.offpage_contents (id) on delete restrict,
  version integer not null check (version >= 1),
  client_id uuid not null references public.clients (id) on delete restrict,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_by_name text not null,
  decision public.review_decision not null,
  feedback text check (feedback is null or length(feedback) <= 5000),
  created_at timestamptz not null default now(),
  check (decision = 'approved' or feedback is not null)
);
create index if not exists offpage_content_decisions_content_idx on public.offpage_content_decisions (content_id, created_at);

-- 2. Triggers -----------------------------------------------------------------------------------------
create trigger offpage_contents_updated_at before update on public.offpage_contents
  for each row execute function public.set_updated_at();
create trigger offpage_contents_audit after insert or update or delete on public.offpage_contents
  for each row execute function public.audit_row_change();
-- Own copy of the append-only guard, so this module does not depend on migration 16's function.
create or replace function public.offpage_history_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: recorded history cannot be changed or deleted', tg_table_name
    using errcode = '42501';
end;
$$;
create trigger offpage_content_versions_immutable before update or delete on public.offpage_content_versions
  for each row execute function public.offpage_history_immutable();
create trigger offpage_content_decisions_immutable before update or delete on public.offpage_content_decisions
  for each row execute function public.offpage_history_immutable();

-- The brand always follows the campaign, and the keyword must be one of the campaign's keywords.
-- security definer so the check sees every campaign keyword whatever the caller may read.
create or replace function public.offpage_contents_derive_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select client_id into new.client_id from public.campaigns where id = new.campaign_id;
  if not exists (
    select 1 from public.campaign_keywords where campaign_id = new.campaign_id and keyword_id = new.keyword_id
  ) then
    raise exception 'Keyword is not one of this campaign''s keywords' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger offpage_contents_derive_client before insert or update of campaign_id, keyword_id on public.offpage_contents
  for each row execute function public.offpage_contents_derive_client();

-- 3. Access -------------------------------------------------------------------------------------------
update public.role_permissions set features = array_append(features, 'intern.content')
  where role = 'intern' and not ('intern.content' = any(features));

alter table public.offpage_contents enable row level security;
alter table public.offpage_content_versions enable row level security;
alter table public.offpage_content_decisions enable row level security;

create policy offpage_contents_read on public.offpage_contents for select to authenticated
  using ((select public.is_super_admin())
    or (submitted_by = (select auth.uid()) and (select public.auth_role()) = 'intern'
        and (select public.has_permission('intern.content'))));
create policy offpage_content_versions_read on public.offpage_content_versions for select to authenticated
  using (content_id in (select id from public.offpage_contents));
create policy offpage_content_decisions_read on public.offpage_content_decisions for select to authenticated
  using (content_id in (select id from public.offpage_contents));

-- Reads only; every write goes through the functions below.
grant select on public.offpage_contents, public.offpage_content_versions, public.offpage_content_decisions to authenticated;

-- 4. Workflow functions -------------------------------------------------------------------------------
-- Creates (p_id null) or resubmits content as a new version and sends it to the client for approval.
-- p_data: campaign_id, keyword_id, backlink_type_id, content_type, title, content_html (sanitized).
create or replace function public.offpage_content_submit(p_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.auth_role();
  v_campaign uuid := nullif(p_data ->> 'campaign_id', '')::uuid;
  v_keyword uuid := nullif(p_data ->> 'keyword_id', '')::uuid;
  v_type uuid := nullif(p_data ->> 'backlink_type_id', '')::uuid;
  v_ctype text := p_data ->> 'content_type';
  v_title text := btrim(coalesce(p_data ->> 'title', ''));
  v_html text := coalesce(p_data ->> 'content_html', '');
  c public.offpage_contents;
  v_id uuid;
  r record;
begin
  if v_role = 'intern' then
    perform public._require_permission(array['intern.content']);
  elsif v_role is distinct from 'super_admin' then
    raise exception 'You do not have permission to submit content' using errcode = '42501';
  end if;
  if v_campaign is null or not exists (select 1 from public.campaigns where id = v_campaign) then
    raise exception 'Select a campaign' using errcode = '22023';
  end if;
  if v_role = 'intern' and v_campaign not in (select public.my_campaign_ids()) then
    raise exception 'You are not assigned to this campaign' using errcode = '42501';
  end if;
  if v_type is null or not exists (select 1 from public.backlink_types where id = v_type) then
    raise exception 'Select a backlink type' using errcode = '22023';
  end if;
  if exists (select 1 from public.campaign_backlink_types where campaign_id = v_campaign)
     and not exists (select 1 from public.campaign_backlink_types where campaign_id = v_campaign and backlink_type_id = v_type) then
    raise exception 'That backlink type is not used by this campaign' using errcode = '22023';
  end if;
  if v_title = '' or btrim(v_html) = '' then
    raise exception 'Content title and content are required' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.offpage_contents (campaign_id, keyword_id, backlink_type_id, content_type, title, content_html, submitted_by)
    values (v_campaign, v_keyword, v_type, v_ctype, v_title, v_html, auth.uid())
    returning * into c;
  else
    select * into c from public.offpage_contents where id = p_id for update;
    if not found or (v_role = 'intern' and c.submitted_by is distinct from auth.uid()) then
      raise exception 'Content not found' using errcode = 'P0002';
    end if;
    if c.status not in ('awaiting_client_approval', 'changes_requested') then
      raise exception 'Approved or rejected content can no longer be changed' using errcode = '22023';
    end if;
    update public.offpage_contents set
      campaign_id = v_campaign, keyword_id = v_keyword, backlink_type_id = v_type, content_type = v_ctype,
      title = v_title, content_html = v_html, status = 'awaiting_client_approval',
      current_version = c.current_version + 1, submitted_at = now(), updated_by = auth.uid()
    where id = p_id
    returning * into c;
  end if;
  v_id := c.id;

  insert into public.offpage_content_versions (content_id, version, campaign_id, keyword_id, backlink_type_id,
    content_type, title, content_html, submitted_by)
  values (v_id, c.current_version, c.campaign_id, c.keyword_id, c.backlink_type_id, c.content_type, c.title,
    c.content_html, auth.uid());

  for r in
    select cm.user_id from public.client_members cm
    join public.profiles p on p.id = cm.user_id
    where cm.client_id = c.client_id and cm.can_approve and p.status = 'active' and p.role = 'client'
  loop
    perform public.notify(r.user_id, 'content_approval_requested', 'Content awaiting your approval',
      c.code || ' · ' || c.title, '/portal/approvals/content/' || v_id, 'offpage_content', v_id,
      'content-review:' || v_id || ':' || c.current_version);
  end loop;
  perform public.notify_admins('content_submitted', 'Content ' || c.code || ' sent for client approval',
    coalesce(public.current_actor_name(), 'A team member') || ' submitted "' || c.title || '"'
      || case when c.current_version > 1 then ' (version ' || c.current_version || ')' else '' end,
    '/admin/page-content?q=' || c.code, 'offpage_content', v_id, 'content-submitted:' || v_id || ':' || c.current_version);
  perform public.log_activity('offpage_content.submitted', 'offpage_contents', v_id::text, c.client_id,
    c.code || ' submitted for client approval (v' || c.current_version || ')',
    jsonb_build_object('version', c.current_version));
  return v_id;
end;
$$;

-- A client approver decides on the exact version they saw.
create or replace function public.offpage_content_client_decision(
  p_id uuid, p_decision public.review_decision, p_feedback text, p_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.offpage_contents;
  v_name text;
  v_feedback text := nullif(btrim(p_feedback), '');
  v_status text;
  v_label text := replace(p_decision::text, '_', ' ');
begin
  perform public._require_client();
  perform public._require_permission(array['portal.approvals.decide']);
  select * into c from public.offpage_contents where id = p_id for update;
  if not found or not exists (
    select 1 from public.client_members cm
    where cm.client_id = c.client_id and cm.user_id = auth.uid() and cm.can_approve) then
    raise exception 'Content not found' using errcode = 'P0002';
  end if;
  if c.status <> 'awaiting_client_approval' then
    raise exception 'This content is not awaiting your approval' using errcode = '22023';
  end if;
  if p_version is distinct from c.current_version then
    raise exception 'The content changed while you were reviewing it. Please review version % instead.',
      c.current_version using errcode = '40001';
  end if;
  if p_decision <> 'approved' and v_feedback is null then
    raise exception 'Please explain the reason for your decision' using errcode = '22023';
  end if;

  v_name := coalesce(public.current_actor_name(), 'Client');
  insert into public.offpage_content_decisions (content_id, version, client_id, decided_by, decided_by_name, decision, feedback)
  values (p_id, c.current_version, c.client_id, auth.uid(), v_name, p_decision, v_feedback);

  v_status := case p_decision when 'approved' then 'approved' when 'changes_requested' then 'changes_requested' else 'rejected' end;
  update public.offpage_contents
    set status = v_status,
        approved_version = case when p_decision = 'approved' then c.current_version else approved_version end
    where id = p_id;

  perform public.notify(c.submitted_by, 'content_' || p_decision::text, c.code || ' ' || v_label || ' by client',
    coalesce(v_feedback, v_name || ' approved version ' || c.current_version), '/intern/content?q=' || c.code,
    'offpage_content', p_id, 'content-decision:' || p_id || ':' || c.current_version);
  perform public.notify_admins('content_' || p_decision::text, c.code || ' ' || v_label || ' by client',
    coalesce(v_feedback, v_name || ' approved version ' || c.current_version), '/admin/page-content?q=' || c.code,
    'offpage_content', p_id, 'content-decision:' || p_id || ':' || c.current_version);
  perform public.log_activity('offpage_content.client_' || p_decision::text, 'offpage_contents', p_id::text, c.client_id,
    c.code || ' ' || v_label || ' by ' || v_name || ' (v' || c.current_version || ')',
    jsonb_build_object('version', c.current_version, 'feedback', v_feedback));
end;
$$;

-- 5. Client portal reads ------------------------------------------------------------------------------
create or replace function public.client_portal_offpage_contents(p_queue_only boolean default false)
returns table (
  id uuid, code text, client_id uuid, campaign_code text, campaign_name text, keyword text, backlink_type text,
  content_type text, title text, status text, current_version integer, approved_version integer,
  submitted_at timestamptz, author_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public._require_client();
  perform public._require_permission(array['portal.approvals']);
  return query
  select o.id, o.code, o.client_id, c.code, c.name, k.keyword, bt.name, o.content_type, o.title, o.status,
    o.current_version, o.approved_version, o.submitted_at,
    case when (public.client_portal_settings(o.client_id) ->> 'show_intern_names')::boolean then p.full_name end
  from public.offpage_contents o
  join public.campaigns c on c.id = o.campaign_id
  join public.keywords k on k.id = o.keyword_id
  join public.backlink_types bt on bt.id = o.backlink_type_id
  join public.profiles p on p.id = o.submitted_by
  where o.client_id in (select public.my_client_ids())
    and (not p_queue_only or o.status = 'awaiting_client_approval')
  order by o.submitted_at desc;
end;
$$;

create or replace function public.client_portal_offpage_content(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.offpage_contents;
begin
  perform public._require_client();
  perform public._require_permission(array['portal.approvals']);
  select * into o from public.offpage_contents where id = p_id and client_id in (select public.my_client_ids());
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', o.id, 'code', o.code, 'status', o.status, 'title', o.title, 'content_html', o.content_html,
    'content_type', o.content_type, 'current_version', o.current_version, 'approved_version', o.approved_version,
    'submitted_at', o.submitted_at,
    'campaign', (select jsonb_build_object('code', c.code, 'name', c.name) from public.campaigns c where c.id = o.campaign_id),
    'keyword', (select k.keyword from public.keywords k where k.id = o.keyword_id),
    'backlink_type', (select bt.name from public.backlink_types bt where bt.id = o.backlink_type_id),
    'can_approve', exists (select 1 from public.client_members cm
                           where cm.client_id = o.client_id and cm.user_id = auth.uid() and cm.can_approve),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', v.version, 'title', v.title,
                   'content_html', v.content_html, 'created_at', v.created_at) order by v.version desc)
                 from public.offpage_content_versions v where v.content_id = o.id), '[]'::jsonb),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('version', d.version, 'decision', d.decision,
                    'feedback', d.feedback, 'decided_by_name', d.decided_by_name, 'created_at', d.created_at)
                    order by d.created_at desc)
                  from public.offpage_content_decisions d where d.content_id = o.id), '[]'::jsonb)
  );
end;
$$;

-- 6. Execute permissions ------------------------------------------------------------------------------
revoke execute on function public.offpage_contents_derive_client(), public.offpage_history_immutable() from public, anon, authenticated;
revoke execute on function
  public.offpage_content_submit(uuid, jsonb),
  public.offpage_content_client_decision(uuid, public.review_decision, text, integer),
  public.client_portal_offpage_contents(boolean),
  public.client_portal_offpage_content(uuid)
from public, anon;
grant execute on function
  public.offpage_content_submit(uuid, jsonb),
  public.offpage_content_client_decision(uuid, public.review_decision, text, integer),
  public.client_portal_offpage_contents(boolean),
  public.client_portal_offpage_content(uuid)
to authenticated;

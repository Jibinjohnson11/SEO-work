-- Workflow engine. All submission state changes go through these functions, which check the
-- caller's role, validate the transition, write history and send notifications atomically.

-- ---------------------------------------------------------------------------
-- Utilities
-- ---------------------------------------------------------------------------
create or replace function public.get_setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.application_settings where key = p_key), '{}'::jsonb)
$$;

-- Canonical form of a URL for duplicate detection and link matching. Mirrored by
-- normalizeUrl() in src/lib/url.ts (kept in sync by tests/db.test.ts).
create or replace function public.normalize_url(p_url text)
returns text
language plpgsql
immutable
as $$
declare
  v text := btrim(coalesce(p_url, ''));
  m text[];
  v_host text;
  v_path text;
  v_query text;
begin
  if v = '' then
    return null;
  end if;
  if v !~* '^[a-z][a-z0-9+.-]*://' then
    v := 'https://' || v;
  end if;
  v := regexp_replace(v, '#.*$', '');
  m := regexp_match(v, '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?]+)([^?]*)(\?.*)?$');
  if m is null then
    return lower(v);
  end if;
  v_host := lower(regexp_replace(m[1], '^.*@', ''));
  v_host := regexp_replace(v_host, ':(80|443)$', '');
  v_host := regexp_replace(v_host, '^www\.', '');
  v_host := regexp_replace(v_host, '\.$', '');
  v_path := regexp_replace(coalesce(m[2], ''), '/+$', '');
  v_query := coalesce(m[3], '');
  if v_query = '?' then
    v_query := '';
  end if;
  return 'https://' || v_host || v_path || v_query;
end;
$$;

create or replace function public.url_domain(p_url text)
returns text
language sql
immutable
as $$
  select (regexp_match(public.normalize_url(p_url), '^https://([^/?:]+)'))[1]
$$;

create or replace function public.is_http_url(p_url text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_url ~* '^https?://[^\s/?#]+\.[^\s/?#]+([/?#]\S*)?$', false)
$$;

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
$$;

create or replace function public.notify(
  p_user_id uuid, p_type text, p_title text, p_body text, p_link text,
  p_entity_type text, p_entity_id uuid, p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return;
  end if;
  insert into public.notifications (user_id, type, title, body, link, entity_type, entity_id, dedupe_key)
  values (p_user_id, p_type, p_title, p_body, p_link, p_entity_type, p_entity_id, p_dedupe_key)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
end;
$$;

create or replace function public.notify_admins(
  p_type text, p_title text, p_body text, p_link text, p_entity_type text, p_entity_id uuid, p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select id from public.profiles where role = 'super_admin' and status = 'active' loop
    perform public.notify(r.id, p_type, p_title, p_body, p_link, p_entity_type, p_entity_id, p_dedupe_key);
  end loop;
end;
$$;

create or replace function public.notify_client_approvers(
  p_client_id uuid, p_type text, p_title text, p_body text, p_link text, p_entity_id uuid, p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select cm.user_id from public.client_members cm
    join public.profiles p on p.id = cm.user_id
    where cm.client_id = p_client_id and cm.can_approve and p.status = 'active' and p.role = 'client'
  loop
    perform public.notify(r.user_id, p_type, p_title, p_body, p_link, 'submission', p_entity_id, p_dedupe_key);
  end loop;
end;
$$;

create or replace function public.current_actor_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()
$$;

-- Status change with an optional note captured by the submission_events trigger.
create or replace function public._set_submission_status(p_id uuid, p_status public.submission_status, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('linkops.transition_note', coalesce(p_note, ''), true);
  update public.backlink_submissions set status = p_status where id = p_id;
  perform set_config('linkops.transition_note', '', true);
end;
$$;

create or replace function public._submission_material(s public.backlink_submissions)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'proposed_website', s.proposed_website,
    'placement_url', s.placement_url,
    'target_url', s.target_url,
    'anchor_text', s.anchor_text,
    'content_title', s.content_title,
    'content_draft', s.content_draft
  )
$$;

-- Snapshot the submission as a new version when material content changed since the last one.
-- Returns true when a new version was written.
create or replace function public._snapshot_submission(p_id uuid, p_summary text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
  v_hash text;
  v_last text;
begin
  select * into s from public.backlink_submissions where id = p_id;
  v_hash := md5(public._submission_material(s)::text);
  select content_hash into v_last from public.submission_versions
    where submission_id = p_id order by version desc limit 1;
  if v_last is not distinct from v_hash then
    return false;
  end if;
  insert into public.submission_versions (submission_id, version, snapshot, content_hash, change_summary, created_by)
  values (
    p_id, s.current_version + 1,
    public._submission_material(s) || jsonb_build_object(
      'link_attribute', s.link_attribute, 'backlink_type_id', s.backlink_type_id, 'keyword_id', s.keyword_id),
    v_hash, p_summary, auth.uid());
  update public.backlink_submissions set current_version = current_version + 1 where id = p_id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Intern: create / edit / submit
-- ---------------------------------------------------------------------------
create or replace function public.submission_save(p_id uuid, p_data jsonb, p_submit boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  s public.backlink_submissions;
  c public.campaigns;
  f record;
  t public.backlink_types;
  v_campaign uuid;
  v_type uuid;
  v_keyword uuid := nullif(p_data ->> 'keyword_id', '')::uuid;
  v_task uuid := nullif(p_data ->> 'task_id', '')::uuid;
  v_field text;
  v_id uuid;
  v_next public.submission_status;
begin
  if public.auth_role() is distinct from 'intern' then
    raise exception 'Only interns can create or edit their submissions' using errcode = '42501';
  end if;

  if p_id is not null then
    select * into s from public.backlink_submissions where id = p_id for update;
    if not found or s.intern_id <> v_uid then
      raise exception 'Submission not found' using errcode = 'P0002';
    end if;
    if s.status not in ('draft', 'internal_changes_requested', 'client_changes_requested') then
      raise exception 'This submission can no longer be edited (status: %)', s.status using errcode = '22023';
    end if;
    v_campaign := s.campaign_id;
  else
    v_campaign := nullif(p_data ->> 'campaign_id', '')::uuid;
  end if;

  select * into c from public.campaigns where id = v_campaign;
  if not found or v_campaign not in (select public.my_campaign_ids()) then
    raise exception 'You are not assigned to this campaign' using errcode = '42501';
  end if;
  if c.status <> 'active' then
    raise exception 'Campaign % is not active', c.code using errcode = '22023';
  end if;

  v_type := coalesce(nullif(p_data ->> 'backlink_type_id', '')::uuid, s.backlink_type_id);
  select * into t from public.backlink_types where id = v_type and is_active;
  if not found then
    raise exception 'Backlink type is not available' using errcode = '22023';
  end if;
  if exists (select 1 from public.campaign_backlink_types where campaign_id = v_campaign)
     and not exists (select 1 from public.campaign_backlink_types
                     where campaign_id = v_campaign and backlink_type_id = v_type) then
    raise exception 'Backlink type "%" is not allowed for campaign %', t.name, c.code using errcode = '22023';
  end if;

  if v_keyword is not null and not exists (
    select 1 from public.campaign_keywords where campaign_id = v_campaign and keyword_id = v_keyword) then
    raise exception 'Keyword is not part of this campaign' using errcode = '22023';
  end if;
  if v_task is not null and not exists (
    select 1 from public.tasks where id = v_task and intern_id = v_uid and campaign_id = v_campaign
      and status not in ('cancelled', 'completed')) then
    raise exception 'Task is not an open task of yours for this campaign' using errcode = '22023';
  end if;

  if nullif(btrim(p_data ->> 'proposed_website'), '') is null then
    raise exception 'Proposed website is required' using errcode = '22023';
  end if;
  if nullif(btrim(p_data ->> 'target_url'), '') is null or not public.is_http_url(btrim(p_data ->> 'target_url')) then
    raise exception 'A valid target URL is required' using errcode = '22023';
  end if;
  if nullif(btrim(p_data ->> 'placement_url'), '') is not null
     and not public.is_http_url(btrim(p_data ->> 'placement_url')) then
    raise exception 'Proposed placement URL is not a valid URL' using errcode = '22023';
  end if;

  if p_submit then
    foreach v_field in array t.required_fields loop
      if nullif(btrim(p_data ->> v_field), '') is null then
        raise exception 'Field "%" is required for % submissions', replace(v_field, '_', ' '), t.name
          using errcode = '22023';
      end if;
    end loop;
  end if;

  if p_id is null then
    insert into public.backlink_submissions (client_id, campaign_id, intern_id, backlink_type_id, keyword_id, task_id,
      proposed_website, proposed_domain, placement_url, target_url, anchor_text, content_title, content_draft, notes,
      domain_rating, domain_authority, estimated_traffic, website_relevance, outreach_contact, outreach_status,
      link_attribute)
    values (c.client_id, v_campaign, v_uid, v_type, v_keyword, v_task,
      btrim(p_data ->> 'proposed_website'), coalesce(public.url_domain(p_data ->> 'proposed_website'), ''),
      nullif(btrim(p_data ->> 'placement_url'), ''), btrim(p_data ->> 'target_url'),
      nullif(btrim(p_data ->> 'anchor_text'), ''), nullif(btrim(p_data ->> 'content_title'), ''),
      nullif(p_data ->> 'content_draft', ''), nullif(p_data ->> 'notes', ''),
      nullif(p_data ->> 'domain_rating', '')::numeric, nullif(p_data ->> 'domain_authority', '')::numeric,
      nullif(p_data ->> 'estimated_traffic', '')::integer, nullif(btrim(p_data ->> 'website_relevance'), ''),
      nullif(btrim(p_data ->> 'outreach_contact'), ''), nullif(p_data ->> 'outreach_status', '')::public.outreach_status,
      nullif(p_data ->> 'link_attribute', '')::public.link_attribute)
    returning id into v_id;
    perform public.log_activity('submission.created', 'backlink_submissions', v_id::text, c.client_id,
      'Draft created', '{}'::jsonb);
  else
    v_id := p_id;
    update public.backlink_submissions set
      backlink_type_id = v_type, keyword_id = v_keyword, task_id = v_task,
      proposed_website = btrim(p_data ->> 'proposed_website'),
      proposed_domain = coalesce(public.url_domain(p_data ->> 'proposed_website'), ''),
      placement_url = nullif(btrim(p_data ->> 'placement_url'), ''),
      target_url = btrim(p_data ->> 'target_url'),
      anchor_text = nullif(btrim(p_data ->> 'anchor_text'), ''),
      content_title = nullif(btrim(p_data ->> 'content_title'), ''),
      content_draft = nullif(p_data ->> 'content_draft', ''),
      notes = nullif(p_data ->> 'notes', ''),
      domain_rating = nullif(p_data ->> 'domain_rating', '')::numeric,
      domain_authority = nullif(p_data ->> 'domain_authority', '')::numeric,
      estimated_traffic = nullif(p_data ->> 'estimated_traffic', '')::integer,
      website_relevance = nullif(btrim(p_data ->> 'website_relevance'), ''),
      outreach_contact = nullif(btrim(p_data ->> 'outreach_contact'), ''),
      outreach_status = nullif(p_data ->> 'outreach_status', '')::public.outreach_status,
      link_attribute = nullif(p_data ->> 'link_attribute', '')::public.link_attribute
    where id = v_id;
  end if;

  perform public._task_started(v_task);

  if p_submit then
    perform public._snapshot_submission(v_id, nullif(p_data ->> 'change_summary', ''));
    update public.backlink_submissions
      set first_submitted_at = coalesce(first_submitted_at, now()), last_submitted_at = now()
      where id = v_id;
    perform public._set_submission_status(v_id, 'submitted', nullif(p_data ->> 'change_summary', ''));
    select * into s from public.backlink_submissions where id = v_id;
    select * into f from public.campaign_flags(v_campaign);

    if not f.require_internal_review then
      v_next := case when f.require_client_approval then 'awaiting_client_approval' else 'ready_for_publication' end;
      perform public._set_submission_status(v_id, v_next, 'Internal review not required');
      if v_next = 'awaiting_client_approval' then
        perform public.notify_client_approvers(s.client_id, 'client_approval_requested',
          'Content awaiting your approval', s.code || ' · ' || coalesce(s.content_title, s.proposed_website),
          '/portal/approvals/' || v_id, v_id, 'client-review:' || v_id || ':' || s.current_version);
      end if;
    end if;

    perform public.notify_admins('submission_received', 'New submission ' || s.code,
      coalesce(public.current_actor_name(), 'An intern') || ' submitted ' || coalesce(s.content_title, s.proposed_website)
        || case when s.current_version > 1 then ' (revision v' || s.current_version || ')' else '' end,
      '/admin/submissions/' || v_id, 'submission', v_id, 'submitted:' || v_id || ':' || s.current_version);
    perform public.log_activity('submission.submitted', 'backlink_submissions', v_id::text, s.client_id,
      s.code || ' submitted (v' || s.current_version || ')', jsonb_build_object('version', s.current_version));
  end if;

  return v_id;
end;
$$;

-- Moves the linked task into progress the first time work is saved against it.
create or replace function public._task_started(p_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_task_id is null then
    return false;
  end if;
  update public.tasks set status = 'in_progress'
    where id = p_task_id and status in ('not_started', 'changes_requested');
  return found;
end;
$$;

-- Intern may move their own task forward; everything else is admin-only (direct table access).
create or replace function public.task_set_status(p_task_id uuid, p_status public.task_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  if public.is_super_admin() then
    update public.tasks set status = p_status where id = p_task_id;
    return;
  end if;
  if public.auth_role() is distinct from 'intern' or t.intern_id <> auth.uid() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_status not in ('in_progress', 'submitted') or t.status in ('completed', 'cancelled') then
    raise exception 'Interns can only mark tasks as in progress or submitted' using errcode = '42501';
  end if;
  update public.tasks set status = p_status where id = p_task_id;
  if p_status = 'submitted' then
    perform public.notify_admins('task_submitted', 'Task ' || t.code || ' marked submitted',
      coalesce(public.current_actor_name(), 'An intern') || ' marked "' || t.title || '" as submitted',
      '/admin/tasks?q=' || t.code, 'task', t.id, 'task-submitted:' || t.id || ':' || current_date);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Super Admin: internal review
-- ---------------------------------------------------------------------------
create or replace function public._require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.submission_start_review(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
begin
  perform public._require_admin();
  select * into s from public.backlink_submissions where id = p_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if s.status <> 'submitted' then
    raise exception 'Only newly submitted work can be moved into review' using errcode = '22023';
  end if;
  perform public._set_submission_status(p_id, 'internal_review', null);
  update public.tasks set status = 'under_review' where id = s.task_id and status in ('in_progress', 'submitted');
end;
$$;

create or replace function public.submission_send_to_client(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
  f record;
begin
  perform public._require_admin();
  select * into s from public.backlink_submissions where id = p_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if s.status <> 'internally_approved' then
    raise exception 'Only internally approved submissions can be sent to the client' using errcode = '22023';
  end if;
  select * into f from public.campaign_flags(s.campaign_id);
  if not f.require_client_approval then
    perform public._set_submission_status(p_id, 'ready_for_publication', 'Client approval not required');
    return;
  end if;
  perform public._set_submission_status(p_id, 'awaiting_client_approval', null);
  perform public.notify_client_approvers(s.client_id, 'client_approval_requested', 'Content awaiting your approval',
    s.code || ' · ' || coalesce(s.content_title, s.proposed_website), '/portal/approvals/' || p_id, p_id,
    'client-review:' || p_id || ':' || s.current_version);
  perform public.notify(s.intern_id, 'sent_to_client', s.code || ' sent to client',
    'Your submission was forwarded for client approval', '/intern/submissions/' || p_id, 'submission', p_id,
    'sent-to-client:' || p_id || ':' || s.current_version);
  perform public.log_activity('submission.sent_to_client', 'backlink_submissions', p_id::text, s.client_id,
    s.code || ' sent for client approval (v' || s.current_version || ')', '{}'::jsonb);
end;
$$;

create or replace function public.submission_internal_decision(
  p_id uuid,
  p_decision public.review_decision,
  p_comments text,
  p_checklist jsonb default '{}'::jsonb,
  p_medical jsonb default null,
  p_forward boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
  f record;
  v_medical_required boolean;
begin
  perform public._require_admin();
  select * into s from public.backlink_submissions where id = p_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if s.status not in ('submitted', 'internal_review') then
    raise exception 'Submission is not awaiting internal review (status: %)', s.status using errcode = '22023';
  end if;
  if p_decision <> 'approved' and nullif(btrim(p_comments), '') is null then
    raise exception 'Feedback is required when requesting changes or rejecting' using errcode = '22023';
  end if;

  select * into f from public.campaign_flags(s.campaign_id);
  v_medical_required := f.is_medical
    and coalesce((public.get_setting('approval') ->> 'medical_review_required')::boolean, true);
  if p_decision = 'approved' and v_medical_required then
    if p_medical is null
       or coalesce((p_medical ->> 'medical_accuracy_reviewed')::boolean, false) is not true
       or coalesce((p_medical ->> 'claims_verified')::boolean, false) is not true
       or coalesce((p_medical ->> 'sources_checked')::boolean, false) is not true
       or nullif(btrim(p_medical ->> 'medical_reviewer_name'), '') is null then
      raise exception 'Medical review checklist must be completed before approving medical content'
        using errcode = '22023';
    end if;
  end if;

  insert into public.internal_reviews (submission_id, version, reviewer_id, reviewer_name, decision, comments, checklist,
    medical_accuracy_reviewed, medical_reviewer_name, medical_reviewer_qualification, claims_verified, sources_checked,
    compliance_notes, medical_review_date)
  values (p_id, s.current_version, auth.uid(), coalesce(public.current_actor_name(), 'Super Admin'), p_decision,
    nullif(btrim(p_comments), ''), coalesce(p_checklist, '{}'::jsonb),
    (p_medical ->> 'medical_accuracy_reviewed')::boolean, nullif(btrim(p_medical ->> 'medical_reviewer_name'), ''),
    nullif(btrim(p_medical ->> 'medical_reviewer_qualification'), ''), (p_medical ->> 'claims_verified')::boolean,
    (p_medical ->> 'sources_checked')::boolean, nullif(btrim(p_medical ->> 'compliance_notes'), ''),
    coalesce(nullif(p_medical ->> 'medical_review_date', '')::date,
             case when p_medical is not null then current_date end));

  if p_decision = 'approved' then
    perform public._set_submission_status(p_id, 'internally_approved', nullif(btrim(p_comments), ''));
    update public.tasks set status = 'in_progress' where id = s.task_id and status in ('under_review', 'changes_requested');
    perform public.notify(s.intern_id, 'internal_approved', s.code || ' approved internally',
      coalesce(nullif(btrim(p_comments), ''), 'Your submission passed internal review'),
      '/intern/submissions/' || p_id, 'submission', p_id, 'internal-decision:' || p_id || ':' || s.current_version);
    perform public.log_activity('submission.internally_approved', 'backlink_submissions', p_id::text, s.client_id,
      s.code || ' approved internally (v' || s.current_version || ')', '{}'::jsonb);
    if p_forward or not f.require_client_approval then
      perform public.submission_send_to_client(p_id);
    end if;
  elsif p_decision = 'changes_requested' then
    perform public._set_submission_status(p_id, 'internal_changes_requested', btrim(p_comments));
    update public.tasks set status = 'changes_requested' where id = s.task_id and status not in ('completed', 'cancelled');
    perform public.notify(s.intern_id, 'internal_changes_requested', 'Changes requested on ' || s.code, btrim(p_comments),
      '/intern/submissions/' || p_id, 'submission', p_id, 'internal-decision:' || p_id || ':' || s.current_version);
    perform public.log_activity('submission.internal_changes_requested', 'backlink_submissions', p_id::text,
      s.client_id, s.code || ' returned for changes', '{}'::jsonb);
  else
    perform public._set_submission_status(p_id, 'internal_rejected', btrim(p_comments));
    perform public.notify(s.intern_id, 'internal_rejected', s.code || ' was rejected', btrim(p_comments),
      '/intern/submissions/' || p_id, 'submission', p_id, 'internal-decision:' || p_id || ':' || s.current_version);
    perform public.log_activity('submission.internal_rejected', 'backlink_submissions', p_id::text, s.client_id,
      s.code || ' rejected internally', '{}'::jsonb);
  end if;
end;
$$;

-- Admin edits to submission content. Material changes create a new version and, when the
-- current version had been approved by the client, send it back for re-approval.
create or replace function public.submission_admin_edit(p_id uuid, p_data jsonb, p_summary text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
  f record;
  v_new_version boolean;
begin
  perform public._require_admin();
  select * into s from public.backlink_submissions where id = p_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if s.status in ('published', 'verification_pending', 'verified_live', 'verification_failed', 'archived') then
    raise exception 'Published or archived submissions cannot be edited' using errcode = '22023';
  end if;
  if nullif(btrim(p_data ->> 'target_url'), '') is null or not public.is_http_url(btrim(p_data ->> 'target_url')) then
    raise exception 'A valid target URL is required' using errcode = '22023';
  end if;

  update public.backlink_submissions set
    proposed_website = coalesce(nullif(btrim(p_data ->> 'proposed_website'), ''), proposed_website),
    proposed_domain = coalesce(public.url_domain(nullif(btrim(p_data ->> 'proposed_website'), '')), proposed_domain),
    placement_url = nullif(btrim(p_data ->> 'placement_url'), ''),
    target_url = btrim(p_data ->> 'target_url'),
    anchor_text = nullif(btrim(p_data ->> 'anchor_text'), ''),
    content_title = nullif(btrim(p_data ->> 'content_title'), ''),
    content_draft = nullif(p_data ->> 'content_draft', ''),
    notes = nullif(p_data ->> 'notes', ''),
    link_attribute = nullif(p_data ->> 'link_attribute', '')::public.link_attribute
  where id = p_id;

  -- Drafts are not versioned until the intern submits them.
  if s.status = 'draft' then
    return;
  end if;
  v_new_version := public._snapshot_submission(p_id, coalesce(nullif(btrim(p_summary), ''), 'Edited by Super Admin'));
  if not v_new_version then
    return;
  end if;
  perform public.log_activity('submission.admin_edited', 'backlink_submissions', p_id::text, s.client_id,
    s.code || ' content edited by Super Admin (v' || (s.current_version + 1) || ')',
    jsonb_build_object('summary', p_summary));

  select * into f from public.campaign_flags(s.campaign_id);
  if s.status in ('client_approved', 'ready_for_publication') and f.require_client_approval
     and f.reapproval_on_material_change then
    perform public._set_submission_status(p_id, 'awaiting_client_approval',
      'Material change after approval; re-approval required');
    perform public.notify_client_approvers(s.client_id, 'client_reapproval_requested', 'Revised content needs approval',
      s.code || ' was revised after your approval', '/portal/approvals/' || p_id, p_id,
      'client-review:' || p_id || ':' || (s.current_version + 1));
  elsif s.status = 'awaiting_client_approval' then
    perform public.notify_client_approvers(s.client_id, 'client_approval_requested', 'Content updated for review',
      s.code || ' was updated to version ' || (s.current_version + 1), '/portal/approvals/' || p_id, p_id,
      'client-review:' || p_id || ':' || (s.current_version + 1));
  end if;
end;
$$;

create or replace function public.submission_mark_ready(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
  f record;
begin
  perform public._require_admin();
  select * into s from public.backlink_submissions where id = p_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  select * into f from public.campaign_flags(s.campaign_id);
  if not (s.status = 'client_approved'
          or (s.status = 'internally_approved' and not f.require_client_approval)) then
    raise exception 'Submission needs the required approvals before publication' using errcode = '22023';
  end if;
  perform public._set_submission_status(p_id, 'ready_for_publication', null);
  perform public.notify(s.intern_id, 'ready_for_publication', s.code || ' is ready for publication',
    'Publish the approved content and record the live URL', '/intern/submissions/' || p_id, 'submission', p_id,
    'ready:' || p_id || ':' || s.current_version);
end;
$$;

create or replace function public.submission_admin_override(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
begin
  perform public._require_admin();
  if not coalesce((public.get_setting('approval') ->> 'allow_admin_override')::boolean, false) then
    raise exception 'Admin override is disabled in Approval Settings' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'An override reason is required' using errcode = '22023';
  end if;
  select * into s from public.backlink_submissions where id = p_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if s.status not in ('awaiting_client_approval', 'client_changes_requested') then
    raise exception 'Override only applies to submissions awaiting a client decision' using errcode = '22023';
  end if;
  insert into public.client_approvals (submission_id, client_id, version, decided_by, decided_by_name, decision,
    feedback, is_admin_override)
  values (p_id, s.client_id, s.current_version, auth.uid(), coalesce(public.current_actor_name(), 'Super Admin'),
    'approved', btrim(p_reason), true);
  perform public._set_submission_status(p_id, 'ready_for_publication', 'Admin override: ' || btrim(p_reason));
  perform public.notify_client_approvers(s.client_id, 'admin_override', 'Approval overridden on ' || s.code,
    'The agency proceeded without your approval: ' || btrim(p_reason), '/portal/approvals/' || p_id, p_id,
    'override:' || p_id || ':' || s.current_version);
  perform public.log_activity('submission.admin_override', 'backlink_submissions', p_id::text, s.client_id,
    'ADMIN OVERRIDE of client approval on ' || s.code, jsonb_build_object('reason', p_reason,
      'version', s.current_version));
end;
$$;

create or replace function public.submission_reassign(p_id uuid, p_intern_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
begin
  perform public._require_admin();
  select * into s from public.backlink_submissions where id = p_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if s.status not in ('draft', 'internal_changes_requested', 'client_changes_requested', 'internal_rejected',
                      'client_rejected') then
    raise exception 'Only drafts, returned or rejected submissions can be reassigned' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_intern_id and role = 'intern' and status = 'active') then
    raise exception 'Target user is not an active intern' using errcode = '22023';
  end if;
  insert into public.intern_assignments (campaign_id, intern_id, assigned_by)
  values (s.campaign_id, p_intern_id, auth.uid())
  on conflict (campaign_id, intern_id) do update set is_active = true;

  update public.backlink_submissions set intern_id = p_intern_id, task_id = null where id = p_id;
  if s.status in ('internal_rejected', 'client_rejected') then
    perform public._set_submission_status(p_id, 'internal_changes_requested',
      'Reassigned for rework' || coalesce(': ' || nullif(btrim(p_note), ''), ''));
  end if;
  perform public.notify(p_intern_id, 'submission_reassigned', s.code || ' assigned to you',
    coalesce(nullif(btrim(p_note), ''), 'A submission was reassigned to you for revision'),
    '/intern/submissions/' || p_id, 'submission', p_id, 'reassigned:' || p_id || ':' || p_intern_id);
  perform public.log_activity('submission.reassigned', 'backlink_submissions', p_id::text, s.client_id,
    s.code || ' reassigned', jsonb_build_object('from', s.intern_id, 'to', p_intern_id, 'note', p_note));
end;
$$;

create or replace function public.submission_archive(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
begin
  perform public._require_admin();
  select * into s from public.backlink_submissions where id = p_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if s.status = 'archived' then
    return;
  end if;
  perform public._set_submission_status(p_id, 'archived', nullif(btrim(p_reason), ''));
  perform public.log_activity('submission.archived', 'backlink_submissions', p_id::text, s.client_id,
    s.code || ' archived', jsonb_build_object('reason', p_reason, 'previous_status', s.status));
end;
$$;

-- ---------------------------------------------------------------------------
-- Client decisions
-- ---------------------------------------------------------------------------
create or replace function public.submission_client_decision(
  p_id uuid, p_decision public.review_decision, p_feedback text, p_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
  v_name text;
begin
  if public.auth_role() is distinct from 'client' then
    raise exception 'Only client users can record client decisions' using errcode = '42501';
  end if;
  select * into s from public.backlink_submissions where id = p_id for update;
  if not found or not exists (
    select 1 from public.client_members cm
    where cm.client_id = s.client_id and cm.user_id = auth.uid() and cm.can_approve) then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if s.status <> 'awaiting_client_approval' then
    raise exception 'This submission is not awaiting your approval' using errcode = '22023';
  end if;
  if p_version is distinct from s.current_version then
    raise exception 'The content changed while you were reviewing it. Please review version % instead.',
      s.current_version using errcode = '40001';
  end if;
  if p_decision <> 'approved' and nullif(btrim(p_feedback), '') is null then
    raise exception 'Please explain the reason for your decision' using errcode = '22023';
  end if;

  v_name := coalesce(public.current_actor_name(), 'Client');
  insert into public.client_approvals (submission_id, client_id, version, decided_by, decided_by_name, decision, feedback)
  values (p_id, s.client_id, s.current_version, auth.uid(), v_name, p_decision, nullif(btrim(p_feedback), ''));

  if p_decision = 'approved' then
    update public.backlink_submissions set client_approved_version = s.current_version where id = p_id;
    perform public._set_submission_status(p_id, 'client_approved', nullif(btrim(p_feedback), ''));
    perform public.notify_admins('client_approved', s.code || ' approved by client',
      v_name || ' approved version ' || s.current_version, '/admin/submissions/' || p_id, 'submission', p_id,
      'client-decision:' || p_id || ':' || s.current_version);
    perform public.notify(s.intern_id, 'client_approved', s.code || ' approved by client',
      'The client approved your content', '/intern/submissions/' || p_id, 'submission', p_id,
      'client-decision:' || p_id || ':' || s.current_version);
  elsif p_decision = 'changes_requested' then
    perform public._set_submission_status(p_id, 'client_changes_requested', btrim(p_feedback));
    update public.tasks set status = 'changes_requested' where id = s.task_id and status not in ('completed', 'cancelled');
    perform public.notify_admins('client_changes_requested', 'Client requested changes on ' || s.code,
      btrim(p_feedback), '/admin/submissions/' || p_id, 'submission', p_id,
      'client-decision:' || p_id || ':' || s.current_version);
    perform public.notify(s.intern_id, 'client_changes_requested', 'Client requested changes on ' || s.code,
      btrim(p_feedback), '/intern/submissions/' || p_id, 'submission', p_id,
      'client-decision:' || p_id || ':' || s.current_version);
  else
    perform public._set_submission_status(p_id, 'client_rejected', btrim(p_feedback));
    perform public.notify_admins('client_rejected', s.code || ' rejected by client', btrim(p_feedback),
      '/admin/submissions/' || p_id, 'submission', p_id, 'client-decision:' || p_id || ':' || s.current_version);
    perform public.notify(s.intern_id, 'client_rejected', s.code || ' rejected by client', btrim(p_feedback),
      '/intern/submissions/' || p_id, 'submission', p_id, 'client-decision:' || p_id || ':' || s.current_version);
  end if;
  perform public.log_activity('submission.client_' || p_decision::text, 'backlink_submissions', p_id::text,
    s.client_id, s.code || ' ' || replace(p_decision::text, '_', ' ') || ' by ' || v_name || ' (v' || s.current_version || ')',
    jsonb_build_object('version', s.current_version, 'feedback', p_feedback));
end;
$$;

-- ---------------------------------------------------------------------------
-- Publication & verification
-- ---------------------------------------------------------------------------
create or replace function public.submission_record_publication(
  p_id uuid, p_published_url text, p_publication_date date, p_link_attribute public.link_attribute,
  p_anchor_text text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.backlink_submissions;
  f record;
  v_norm text := public.normalize_url(p_published_url);
  v_norm_target text;
  v_existing text;
  v_pub_id uuid;
begin
  select * into s from public.backlink_submissions where id = p_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if not (public.is_super_admin() or (public.auth_role() = 'intern' and s.intern_id = auth.uid())) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if s.status not in ('client_approved', 'ready_for_publication') then
    raise exception 'Only approved submissions can be marked as published (status: %)', s.status
      using errcode = '22023';
  end if;
  select * into f from public.campaign_flags(s.campaign_id);
  if f.require_client_approval and not exists (
    select 1 from public.client_approvals
    where submission_id = p_id and version = s.current_version and decision = 'approved') then
    raise exception 'The current content version (v%) has no recorded approval', s.current_version
      using errcode = '22023';
  end if;
  if not public.is_http_url(btrim(p_published_url)) then
    raise exception 'Published URL is not a valid http(s) URL' using errcode = '22023';
  end if;
  if p_publication_date is null or p_publication_date > current_date + 1 then
    raise exception 'Publication date is invalid' using errcode = '22023';
  end if;

  v_norm_target := public.normalize_url(s.target_url);
  select bs.code into v_existing
  from public.published_backlinks pb join public.backlink_submissions bs on bs.id = pb.submission_id
  where pb.normalized_published_url = v_norm and pb.normalized_target_url = v_norm_target;
  if v_existing is not null then
    raise exception 'This placement is already recorded as published under %', v_existing using errcode = '23505';
  end if;

  insert into public.published_backlinks (submission_id, client_id, campaign_id, intern_id, backlink_type_id,
    published_url, normalized_published_url, publisher_domain, target_url, normalized_target_url, anchor_text,
    link_attribute, publication_date, recorded_by)
  values (p_id, s.client_id, s.campaign_id, s.intern_id, s.backlink_type_id, btrim(p_published_url), v_norm,
    public.url_domain(p_published_url), s.target_url, v_norm_target,
    coalesce(nullif(btrim(p_anchor_text), ''), s.anchor_text), coalesce(p_link_attribute, 'unknown'),
    p_publication_date, auth.uid())
  returning id into v_pub_id;

  perform public._set_submission_status(p_id, 'published', null);
  perform public._set_submission_status(p_id, 'verification_pending', null);
  update public.tasks set status = 'completed'
    where id = s.task_id and cadence = 'one_off' and status not in ('cancelled', 'completed')
      and (select count(*) from public.backlink_submissions b
           where b.task_id = s.task_id
             and b.status in ('published', 'verification_pending', 'verified_live')) >= target_quantity;

  perform public.notify_admins('backlink_published', s.code || ' published',
    'Live on ' || public.url_domain(p_published_url), '/admin/published?q=' || s.code, 'submission', p_id,
    'published:' || p_id);
  if (public.client_portal_settings(s.client_id) ->> 'show_published_backlinks')::boolean then
    perform public.notify_client_approvers(s.client_id, 'backlink_published', 'New backlink published',
      coalesce(s.content_title, s.proposed_website) || ' is now live', '/portal/published', p_id, 'published:' || p_id);
  end if;
  perform public.log_activity('submission.published', 'backlink_submissions', p_id::text, s.client_id,
    s.code || ' published at ' || btrim(p_published_url), '{}'::jsonb);
  return v_pub_id;
end;
$$;

-- Records a verification result. Automated checks are run by the server (Super Admin action
-- or the scheduled job using the service role); manual checks require notes.
create or replace function public.record_verification(p_published_id uuid, p_check jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pb public.published_backlinks;
  s public.backlink_submissions;
  v_result public.verification_result := (p_check ->> 'result')::public.verification_result;
  v_method public.verification_method := coalesce((p_check ->> 'method')::public.verification_method, 'automated');
  v_detected public.link_attribute := nullif(p_check ->> 'detected_attribute', '')::public.link_attribute;
begin
  if not (public.is_super_admin() or public.is_trusted_backend()) then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  if v_method = 'manual' and nullif(btrim(p_check ->> 'notes'), '') is null then
    raise exception 'Manual verification requires notes describing the evidence' using errcode = '22023';
  end if;
  select * into pb from public.published_backlinks where id = p_published_id for update;
  if not found then
    raise exception 'Published backlink not found' using errcode = 'P0002';
  end if;

  insert into public.verification_checks (published_backlink_id, method, result, http_status, final_url, link_found,
    found_anchor_text, found_rel, detected_attribute, robots_allowed, response_time_ms, error, notes, checked_by)
  values (p_published_id, v_method, v_result, nullif(p_check ->> 'http_status', '')::integer,
    nullif(p_check ->> 'final_url', ''), (p_check ->> 'link_found')::boolean, nullif(p_check ->> 'found_anchor_text', ''),
    case when p_check ? 'found_rel' then array(select jsonb_array_elements_text(p_check -> 'found_rel')) end,
    v_detected, (p_check ->> 'robots_allowed')::boolean, nullif(p_check ->> 'response_time_ms', '')::integer,
    nullif(p_check ->> 'error', ''), nullif(btrim(p_check ->> 'notes'), ''), auth.uid());

  update public.published_backlinks set
    live_status = case v_result
      when 'live' then 'live'::public.live_status
      when 'changed' then 'changed'::public.live_status
      when 'missing' then 'missing'::public.live_status
      when 'unreachable' then 'unreachable'::public.live_status
      else live_status end,
    last_checked_at = now(),
    first_verified_live_at = case when v_result in ('live', 'changed') then coalesce(first_verified_live_at, now())
                                  else first_verified_live_at end,
    link_attribute = case when link_attribute = 'unknown' and v_detected is not null then v_detected
                          else link_attribute end
  where id = p_published_id;

  select * into s from public.backlink_submissions where id = pb.submission_id for update;
  if s.status = 'archived' then
    return;
  end if;
  if v_result in ('live', 'changed') and s.status <> 'verified_live' then
    perform public._set_submission_status(s.id, 'verified_live', v_method::text || ' verification');
  elsif v_result in ('missing', 'unreachable') and s.status <> 'verification_failed' then
    perform public._set_submission_status(s.id, 'verification_failed',
      coalesce(nullif(p_check ->> 'error', ''), 'Link ' || v_result::text));
    perform public.notify_admins('verification_failed', 'Verification failed for ' || s.code,
      pb.published_url || ' — link ' || v_result::text, '/admin/verification?q=' || s.code, 'submission', s.id,
      'verify-failed:' || s.id || ':' || current_date);
    perform public.notify(s.intern_id, 'verification_failed', 'Verification failed for ' || s.code,
      'The published link could not be confirmed (' || v_result::text || ')', '/intern/submissions/' || s.id,
      'submission', s.id, 'verify-failed:' || s.id || ':' || current_date);
  elsif v_result = 'inconclusive' and s.status = 'published' then
    perform public._set_submission_status(s.id, 'verification_pending', 'Automated check inconclusive');
  end if;
  perform public.log_activity('backlink.verified', 'published_backlinks', p_published_id::text, pb.client_id,
    s.code || ' ' || v_method::text || ' check: ' || v_result::text,
    jsonb_build_object('http_status', p_check ->> 'http_status', 'result', v_result));
end;
$$;

-- ---------------------------------------------------------------------------
-- Deadline reminders (run by the scheduled job)
-- ---------------------------------------------------------------------------
create or replace function public.notify_due_tasks(p_days integer default 2)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  if not (public.is_super_admin() or public.is_trusted_backend()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  for r in
    select t.* from public.tasks t
    join public.profiles p on p.id = t.intern_id and p.status = 'active'
    where t.due_date is not null and t.status not in ('completed', 'cancelled')
      and t.due_date between current_date and current_date + p_days
  loop
    perform public.notify(r.intern_id, 'deadline_approaching', 'Task due ' || to_char(r.due_date, 'DD Mon'),
      r.code || ' · ' || r.title, '/intern/tasks', 'task', r.id, 'due:' || r.id || ':' || r.due_date);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Task assignment notification (fires for admin-created tasks)
-- ---------------------------------------------------------------------------
create or replace function public.tasks_notify_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.intern_id is distinct from old.intern_id then
    perform public.notify(new.intern_id, 'task_assigned', 'New task: ' || new.title,
      new.code || coalesce(' · due ' || to_char(new.due_date, 'DD Mon'), ''), '/intern/tasks', 'task', new.id,
      'task-assigned:' || new.id || ':' || new.intern_id);
  end if;
  return null;
end;
$$;
create trigger tasks_notify after insert or update of intern_id on public.tasks
  for each row execute function public.tasks_notify_assignee();

-- Tasks may only be assigned to interns who are on the campaign.
create or replace function public.tasks_check_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = new.intern_id and role = 'intern') then
    raise exception 'Tasks can only be assigned to interns' using errcode = '23514';
  end if;
  insert into public.intern_assignments (campaign_id, intern_id, assigned_by)
  values (new.campaign_id, new.intern_id, auth.uid())
  on conflict (campaign_id, intern_id) do update set is_active = true;
  return new;
end;
$$;
create trigger tasks_check_assignment before insert or update of intern_id, campaign_id on public.tasks
  for each row execute function public.tasks_check_assignment();

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed window). Returns true when the call is allowed.
-- ---------------------------------------------------------------------------
create or replace function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.rate_limits as rl (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then 1 else rl.count + 1 end,
    window_start = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then now()
                        else rl.window_start end
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.auth_role(), public.is_super_admin(), public.my_client_ids(), public.my_campaign_ids(),
  public.is_my_submission(uuid), public.client_portal_settings(uuid), public.is_trusted_backend(), public.normalize_url(text),
  public.url_domain(text), public.is_http_url(text), public.campaign_flags(uuid),
  public.submission_save(uuid, jsonb, boolean), public.task_set_status(uuid, public.task_status),
  public.submission_start_review(uuid), public.submission_send_to_client(uuid),
  public.submission_internal_decision(uuid, public.review_decision, text, jsonb, jsonb, boolean),
  public.submission_admin_edit(uuid, jsonb, text), public.submission_mark_ready(uuid),
  public.submission_admin_override(uuid, text), public.submission_reassign(uuid, uuid, text),
  public.submission_archive(uuid, text),
  public.submission_client_decision(uuid, public.review_decision, text, integer),
  public.submission_record_publication(uuid, text, date, public.link_attribute, text),
  public.record_verification(uuid, jsonb), public.notify_due_tasks(integer)
to authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to anon, authenticated;
